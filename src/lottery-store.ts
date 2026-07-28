/**
 * Durable SignalLottery records.  Every collection has an explicit index: this
 * module never scans Redis keys.  The deployment supplies the toolkit's
 * REDIS_URL; without it callers receive a friendly unavailable state instead
 * of silently keeping lottery records in process memory.
 */
type User = { telegramId: number; locationOptIn: boolean; creditsPaused: boolean; lastActive: string };
type Signal = { id: string; frequency: string; geoRadius: number; timeWindowMinutes: number };
type Ticket = { id: string; userId: number; drawId: string; sourceDetectionId: string; createdAt: string };
type Draw = { id: string; prize: string; scheduledTime: string; ownerId: number; winnerId?: number; payoutStatus: "pending" | "paid"; transaction?: string };
type Detection = { id: string; signalId: string; device: string; at: string };

export class StoreUnavailable extends Error {}

interface Redis { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<unknown>; }
let clientPromise: Promise<Redis> | undefined;

async function redis(): Promise<Redis> {
  const url = typeof process === "undefined" ? undefined : process.env.REDIS_URL;
  if (!url) throw new StoreUnavailable();
  clientPromise ??= (async () => {
    const { createRequire } = await import("node:module");
    const mod: any = createRequire(import.meta.url)("ioredis");
    const Client = mod.default ?? mod.Redis ?? mod;
    return new Client(url, { maxRetriesPerRequest: null, lazyConnect: false }) as Redis;
  })();
  return clientPromise;
}

const key = (name: string) => `signal-lottery:${name}`;
async function read<T>(name: string): Promise<T | undefined> { const raw = await (await redis()).get(key(name)); return raw ? JSON.parse(raw) as T : undefined; }
async function write<T>(name: string, value: T): Promise<void> { await (await redis()).set(key(name), JSON.stringify(value)); }
async function index(name: string, id: string): Promise<void> { const ids = (await read<string[]>(name)) ?? []; if (!ids.includes(id)) { ids.push(id); await write(name, ids); } }

const INITIAL_SIGNALS: Signal[] = [
  { id: "harbor-88", frequency: "88.1 MHz", geoRadius: 250, timeWindowMinutes: 30 },
  { id: "metro-91", frequency: "91.7 MHz", geoRadius: 200, timeWindowMinutes: 30 },
  { id: "ridge-97", frequency: "97.3 MHz", geoRadius: 300, timeWindowMinutes: 30 },
  { id: "market-101", frequency: "101.5 MHz", geoRadius: 150, timeWindowMinutes: 30 },
  { id: "shore-105", frequency: "105.9 MHz", geoRadius: 250, timeWindowMinutes: 30 },
];

let clock: () => Date = () => new Date();
export const now = () => clock();
/** Test seam for draw and dedupe decisions; production always uses wall time. */
export const setClock = (next?: () => Date) => { clock = next ?? (() => new Date()); };
const stamp = () => now().toISOString();
const makeId = (prefix: string) => `${prefix}-${now().getTime()}-${crypto.randomUUID().slice(0, 8)}`;

export async function touchUser(userId: number): Promise<User> { const user = (await read<User>(`user:${userId}`)) ?? { telegramId: userId, locationOptIn: false, creditsPaused: false, lastActive: stamp() }; user.lastActive = stamp(); await write(`user:${userId}`, user); await index("users", String(userId)); return user; }
export async function setOptIn(userId: number, optedIn: boolean): Promise<User> { const user = await touchUser(userId); user.locationOptIn = optedIn; await write(`user:${userId}`, user); return user; }
export async function setPaused(userId: number, paused: boolean): Promise<User> { const user = await touchUser(userId); user.creditsPaused = paused; await write(`user:${userId}`, user); return user; }
export async function signals(): Promise<Signal[]> { const ids = (await read<string[]>("signals")) ?? []; if (!ids.length) { for (const signal of INITIAL_SIGNALS) { await write(`signal:${signal.id}`, signal); await index("signals", signal.id); } return INITIAL_SIGNALS; } return (await Promise.all(ids.map((id) => read<Signal>(`signal:${id}`)))).filter((s): s is Signal => Boolean(s)); }
export async function addSignal(frequency: string, radius: number, window: number): Promise<Signal> { const signal = { id: makeId("signal"), frequency, geoRadius: radius, timeWindowMinutes: window }; await write(`signal:${signal.id}`, signal); await index("signals", signal.id); return signal; }
export async function createDraw(ownerId: number, prize: string, scheduledTime: string): Promise<Draw> { const draw = { id: makeId("draw"), prize, scheduledTime, ownerId, payoutStatus: "pending" as const }; await write(`draw:${draw.id}`, draw); await index("draws", draw.id); return draw; }
export async function upcomingDraws(): Promise<Draw[]> { const ids = (await read<string[]>("draws")) ?? []; const at = now().getTime(); const draws = (await Promise.all(ids.map((id) => read<Draw>(`draw:${id}`)))).filter((d): d is Draw => d !== undefined); return draws.filter((d) => new Date(d.scheduledTime).getTime() >= at).sort((a,b) => a.scheduledTime.localeCompare(b.scheduledTime)); }
export async function drawsForOwner(ownerId: number): Promise<Draw[]> { const ids = (await read<string[]>("draws")) ?? []; const draws = (await Promise.all(ids.map((id) => read<Draw>(`draw:${id}`)))).filter((d): d is Draw => d !== undefined); return draws.filter((d) => d.ownerId === ownerId); }
export async function ticketsFor(userId: number): Promise<Ticket[]> { const ids = (await read<string[]>(`user:${userId}:tickets`)) ?? []; return (await Promise.all(ids.map((id) => read<Ticket>(`ticket:${id}`)))).filter((t): t is Ticket => Boolean(t)); }
export async function detect(userId: number, signalId: string, device: string): Promise<{ result: "issued"; ticket: Ticket; draw: Draw } | { result: "duplicate" | "paused" | "no-draw" | "unknown" | "no-opt-in" }> {
  const user = await touchUser(userId); if (!user.locationOptIn) return { result: "no-opt-in" }; if (user.creditsPaused) return { result: "paused" };
  if (!(await signals()).some((s) => s.id === signalId)) return { result: "unknown" };
  const duplicate = await read<Detection>(`dedupe:${userId}:${signalId}:${device}`); if (duplicate && now().getTime() - new Date(duplicate.at).getTime() < 30 * 60_000) return { result: "duplicate" };
  const draw = (await upcomingDraws())[0]; if (!draw) return { result: "no-draw" };
  const detection = { id: makeId("detect"), signalId, device, at: stamp() }; await write(`dedupe:${userId}:${signalId}:${device}`, detection);
  const ticket = { id: makeId("entry"), userId, drawId: draw.id, sourceDetectionId: detection.id, createdAt: stamp() }; await write(`ticket:${ticket.id}`, ticket); await index(`user:${userId}:tickets`, ticket.id); await index(`draw:${draw.id}:tickets`, ticket.id); return { result: "issued", ticket, draw };
}
export async function runDraw(drawId: string, ownerId: number): Promise<{ draw?: Draw; winner?: number; reason?: string }> { const draw = await read<Draw>(`draw:${drawId}`); if (!draw || draw.ownerId !== ownerId) return { reason: "not-found" }; if (new Date(draw.scheduledTime).getTime() > now().getTime()) return { reason: "early" }; const ids = (await read<string[]>(`draw:${drawId}:tickets`)) ?? []; if (!ids.length) return { draw, reason: "empty" }; const tickets = (await Promise.all(ids.map((id) => read<Ticket>(`ticket:${id}`)))).filter((t): t is Ticket => Boolean(t)); const winner = tickets[crypto.getRandomValues(new Uint32Array(1))[0] % tickets.length]; draw.winnerId = winner.userId; await write(`draw:${draw.id}`, draw); return { draw, winner: winner.userId }; }
export async function markPaid(drawId: string, ownerId: number, transaction: string): Promise<Draw | undefined> { const draw = await read<Draw>(`draw:${drawId}`); if (!draw || draw.ownerId !== ownerId || !draw.winnerId) return undefined; draw.payoutStatus = "paid"; draw.transaction = transaction; await write(`draw:${draw.id}`, draw); return draw; }
