/** Durable SignalLottery records. Every collection is reached through an explicit index. */
export type Wallet = { address: string; verified: boolean; linkedAt: string; verifiedAt?: string };
export type User = { telegramId: number; locationOptIn: boolean; creditsPaused: boolean; lastActive: string; wallet?: Wallet; kycVerified?: boolean };
export type Signal = { id: string; name: string; frequency: string; geoRadius: number; timeWindowMinutes: number };
export type Ticket = { id: string; userId: number; drawId: string; sourceDetectionId: string; createdAt: string };
export type PayoutStatus = "queued" | "pending" | "processing" | "sent" | "failed" | "recorded" | "completed";
export type Payout = { id: string; userId: number; drawId?: string; winningEntryId?: string; amount: string; currency: string; detectionIds: string[]; transaction?: string; fee?: string; operatorId?: number; recordedAt: string; completedAt?: string; processedAt?: string; failureReason?: string; status: PayoutStatus; kind: "automatic" | "manual" };
export type Draw = { id: string; prize: string; scheduledTime: string; ownerId: number; winnerCount: number; closedAt?: string; winnerIds: number[]; winningEntryIds: string[]; completedAt?: string };
export type PayoutSettings = { enabled: boolean; conversionRate: string; currency: "USDC" | "ETH"; minPayoutThreshold: string; payoutMode: "instant" | "daily" | "weekly"; maxDailyPerUser: string; maxDailyPerDevice: string; feeMode: "deduct" | "platform"; kycThreshold: string; kycRequiredAbove: boolean };
type Detection = { id: string; signalId: string; deviceId: string; timestamp: string; metadata?: string };

export class StoreUnavailable extends Error {}
interface Redis { get(key: string): Promise<string | null>; set(key: string, value: string, ...args: string[]): Promise<unknown>; }
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
async function addToIndex(name: string, id: string): Promise<void> { const ids = (await read<string[]>(name)) ?? []; if (!ids.includes(id)) { ids.push(id); await write(name, ids); } }
const INITIAL_SIGNALS: Signal[] = [
  { id: "harbor-88", name: "Harbor 88", frequency: "88.1 MHz", geoRadius: 250, timeWindowMinutes: 30 }, { id: "metro-91", name: "Metro 91", frequency: "91.7 MHz", geoRadius: 200, timeWindowMinutes: 30 }, { id: "ridge-97", name: "Ridge 97", frequency: "97.3 MHz", geoRadius: 300, timeWindowMinutes: 30 }, { id: "market-101", name: "Market 101", frequency: "101.5 MHz", geoRadius: 150, timeWindowMinutes: 30 }, { id: "shore-105", name: "Shore 105", frequency: "105.9 MHz", geoRadius: 250, timeWindowMinutes: 30 },
];
const DEFAULT_PAYOUT_SETTINGS: PayoutSettings = { enabled: false, conversionRate: "0", currency: "USDC", minPayoutThreshold: "0", payoutMode: "instant", maxDailyPerUser: "0", maxDailyPerDevice: "0", feeMode: "platform", kycThreshold: "0", kycRequiredAbove: false };
let clock: () => Date = () => new Date();
export const now = () => clock(); export const setClock = (next?: () => Date) => { clock = next ?? (() => new Date()); };
const stamp = () => now().toISOString(); const makeId = (prefix: string) => `${prefix}-${now().getTime()}-${crypto.randomUUID().slice(0, 12)}`;
const n = (value: string) => Number(value); const positive = (value: string) => Number.isFinite(n(value)) && n(value) >= 0;
const dayKey = () => now().toISOString().slice(0, 10);

export async function touchUser(userId: number): Promise<User> { const user = (await read<User>(`user:${userId}`)) ?? { telegramId: userId, locationOptIn: false, creditsPaused: false, lastActive: stamp() }; user.lastActive = stamp(); await write(`user:${userId}`, user); await addToIndex("users", String(userId)); return user; }
export async function setOptIn(userId: number, optedIn: boolean): Promise<User> { const user = await touchUser(userId); user.locationOptIn = optedIn; await write(`user:${userId}`, user); return user; }
export async function setPaused(userId: number, paused: boolean): Promise<User> { const user = await touchUser(userId); user.creditsPaused = paused; await write(`user:${userId}`, user); return user; }
export async function claimOperator(userId: number): Promise<boolean> { const owner = await read<number>("operator"); if (owner === undefined) { await write("operator", userId); return true; } return owner === userId; }
export async function linkWallet(userId: number, address: string): Promise<Wallet> { const user = await touchUser(userId); if (user.wallet) await write(`wallet:${user.wallet.address.toLowerCase()}`, ""); user.wallet = { address, verified: false, linkedAt: stamp() }; await write(`user:${userId}`, user); await write(`wallet:${address.toLowerCase()}`, String(userId)); return user.wallet; }
export async function walletFor(userId: number): Promise<Wallet | undefined> { return (await touchUser(userId)).wallet; }
export async function verifyWallet(userId: number, operatorId: number): Promise<boolean> { if (!await claimOperator(operatorId)) return false; const user = await touchUser(userId); if (!user.wallet) return false; user.wallet.verified = true; user.wallet.verifiedAt = stamp(); await write(`user:${userId}`, user); return true; }
export async function verifyWalletAddress(address: string, operatorId: number): Promise<boolean> { const userId = await read<string>(`wallet:${address.toLowerCase()}`); return userId ? verifyWallet(Number(userId), operatorId) : false; }
export async function setKycVerified(userId: number, operatorId: number): Promise<boolean> { if (!await claimOperator(operatorId)) return false; const user = await touchUser(userId); user.kycVerified = true; await write(`user:${userId}`, user); return true; }
export async function linkDevice(userId: number, deviceId: string): Promise<"linked" | "taken"> { await touchUser(userId); const existing = await read<number>(`device:${deviceId}`); if (existing !== undefined && existing !== userId) return "taken"; await write(`device:${deviceId}`, userId); await addToIndex(`user:${userId}:devices`, deviceId); return "linked"; }
export async function devicesFor(userId: number): Promise<string[]> { return (await read<string[]>(`user:${userId}:devices`)) ?? []; }
export async function signals(): Promise<Signal[]> { const ids = (await read<string[]>("signals")) ?? []; if (!ids.length) { for (const signal of INITIAL_SIGNALS) { await write(`signal:${signal.id}`, signal); await addToIndex("signals", signal.id); } return INITIAL_SIGNALS; } return (await Promise.all(ids.map((id) => read<Signal>(`signal:${id}`)))).filter((x): x is Signal => Boolean(x)); }
export async function addSignal(name: string, frequency: string, radius: number, window: number): Promise<Signal> { const signal = { id: makeId("signal"), name, frequency, geoRadius: radius, timeWindowMinutes: window }; await write(`signal:${signal.id}`, signal); await addToIndex("signals", signal.id); return signal; }
export async function createDraw(ownerId: number, prize: string, scheduledTime: string, winnerCount = 3): Promise<Draw> { const draw: Draw = { id: makeId("draw"), prize, scheduledTime, ownerId, winnerCount, winnerIds: [], winningEntryIds: [] }; await write(`draw:${draw.id}`, draw); await addToIndex("draws", draw.id); return draw; }
async function allDraws(): Promise<Draw[]> { const ids = (await read<string[]>("draws")) ?? []; return (await Promise.all(ids.map((id) => read<Draw>(`draw:${id}`)))).filter((x): x is Draw => Boolean(x)); }
export async function upcomingDraws(): Promise<Draw[]> { const at = now().getTime(); return (await allDraws()).filter((d) => !d.completedAt && new Date(d.scheduledTime).getTime() >= at).sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)); }
export async function drawsForOwner(ownerId: number): Promise<Draw[]> { return (await allDraws()).filter((d) => d.ownerId === ownerId); }
export async function ticketsFor(userId: number, drawId?: string): Promise<Ticket[]> { const ids = (await read<string[]>(`user:${userId}:tickets`)) ?? []; const result = (await Promise.all(ids.map((id) => read<Ticket>(`ticket:${id}`)))).filter((x): x is Ticket => Boolean(x)); return drawId ? result.filter((t) => t.drawId === drawId) : result; }
export async function activeTicketCount(userId: number): Promise<number> { const draw = (await upcomingDraws())[0]; return draw ? (await ticketsFor(userId, draw.id)).length : 0; }
export async function payoutSettings(): Promise<PayoutSettings> { return (await read<PayoutSettings>("payout-settings")) ?? { ...DEFAULT_PAYOUT_SETTINGS }; }
export async function updatePayoutSettings(operatorId: number, patch: Partial<PayoutSettings>): Promise<PayoutSettings | undefined> { if (!await claimOperator(operatorId)) return undefined; const current = await payoutSettings(); const next = { ...current, ...patch }; if (!positive(next.conversionRate) || !positive(next.minPayoutThreshold) || !positive(next.maxDailyPerUser) || !positive(next.maxDailyPerDevice) || !positive(next.kycThreshold)) return undefined; await write("payout-settings", next); await audit(operatorId, "payout-settings-updated", "settings"); return next; }
async function audit(actorId: number, action: string, subject: string): Promise<void> { const id = makeId("audit"); await write(`audit:${id}`, { id, actorId, action, subject, at: stamp() }); await addToIndex("audits", id); }

export type AutoPayoutOutcome = "disabled" | "wallet-required" | "kyc-required" | "daily-cap" | "queued" | "pending";
async function createAutomaticPayout(userId: number, deviceId: string, detectionId: string): Promise<AutoPayoutOutcome> {
  const existing = await read<string>(`auto-detection:${detectionId}`); if (existing) return "queued";
  const settings = await payoutSettings(); if (!settings.enabled || n(settings.conversionRate) <= 0) return "disabled";
  const user = await touchUser(userId); if (!user.wallet?.verified) return "wallet-required";
  const amount = n(settings.conversionRate); if (settings.kycRequiredAbove && amount >= n(settings.kycThreshold) && !user.kycVerified) return "kyc-required";
  const userTotal = n((await read<string>(`payout-day:user:${userId}:${dayKey()}`)) ?? "0"); const deviceTotal = n((await read<string>(`payout-day:device:${deviceId}:${dayKey()}`)) ?? "0");
  if ((n(settings.maxDailyPerUser) > 0 && userTotal + amount > n(settings.maxDailyPerUser)) || (n(settings.maxDailyPerDevice) > 0 && deviceTotal + amount > n(settings.maxDailyPerDevice))) return "daily-cap";
  const queued = settings.payoutMode !== "instant" || amount < n(settings.minPayoutThreshold);
  const payout: Payout = { id: makeId("auto-payout"), userId, amount: String(amount), currency: settings.currency, detectionIds: [detectionId], recordedAt: stamp(), status: queued ? "queued" : "pending", kind: "automatic" };
  await write(`payout:${payout.id}`, payout); await write(`auto-detection:${detectionId}`, payout.id); await addToIndex(`user:${userId}:payouts`, payout.id); await addToIndex(queued ? "payout-queue" : "payout-pending", payout.id);
  await write(`payout-day:user:${userId}:${dayKey()}`, String(userTotal + amount)); await write(`payout-day:device:${deviceId}:${dayKey()}`, String(deviceTotal + amount)); await audit(userId, queued ? "automatic-payout-queued" : "automatic-payout-pending", payout.id);
  return queued ? "queued" : "pending";
}
export type DetectionResult = { result: "issued"; ticket: Ticket; draw: Draw; signal: Signal; detectedAt: string; totalEntries: number; userId: number; payout: AutoPayoutOutcome } | { result: "duplicate" | "paused" | "no-draw" | "unknown" | "no-opt-in" | "unlinked" };
export async function detect(signalId: string, deviceId: string, detectionId: string, detectedAt = stamp(), metadata?: string): Promise<DetectionResult> {
  const userId = await read<number>(`device:${deviceId}`); if (userId === undefined) return { result: "unlinked" };
  const signal = (await signals()).find((s) => s.id === signalId); if (!signal) return { result: "unknown" };
  const claimed = await (await redis()).set(key(`detection:${detectionId}`), "claimed", "NX"); if (claimed !== "OK") return { result: "duplicate" };
  const user = await touchUser(userId); if (!user.locationOptIn) return { result: "no-opt-in" }; if (user.creditsPaused) return { result: "paused" };
  const prior = await read<Detection>(`device-signal:${deviceId}:${signalId}`); if (prior && now().getTime() - new Date(prior.timestamp).getTime() < signal.timeWindowMinutes * 60_000) return { result: "duplicate" };
  const draw = (await upcomingDraws())[0]; if (!draw) return { result: "no-draw" };
  const detection: Detection = { id: detectionId, signalId, deviceId, timestamp: detectedAt, metadata }; await write(`device-signal:${deviceId}:${signalId}`, detection);
  const ticket: Ticket = { id: makeId("entry"), userId, drawId: draw.id, sourceDetectionId: detection.id, createdAt: stamp() }; await write(`ticket:${ticket.id}`, ticket); await addToIndex(`user:${userId}:tickets`, ticket.id); await addToIndex(`draw:${draw.id}:tickets`, ticket.id);
  const payout = await createAutomaticPayout(userId, deviceId, detectionId); return { result: "issued", ticket, draw, signal, detectedAt, totalEntries: (await ticketsFor(userId, draw.id)).length, userId, payout };
}
export type DrawResult = { draw: Draw; winners: Array<{ userId: number; ticket: Ticket }> } | { draw?: Draw; reason: "not-found" | "early" | "empty" | "complete" };
export async function runDraw(drawId: string, ownerId: number): Promise<DrawResult> { const draw = await read<Draw>(`draw:${drawId}`); if (!draw || draw.ownerId !== ownerId) return { reason: "not-found" }; if (draw.completedAt) return { draw, reason: "complete" }; if (new Date(draw.scheduledTime).getTime() > now().getTime()) return { draw, reason: "early" }; draw.closedAt = stamp(); const ids = (await read<string[]>(`draw:${drawId}:tickets`)) ?? []; const pool = (await Promise.all(ids.map((id) => read<Ticket>(`ticket:${id}`)))).filter((x): x is Ticket => Boolean(x)); if (!pool.length) { draw.completedAt = stamp(); await write(`draw:${draw.id}`, draw); return { draw, reason: "empty" }; } const remaining = [...pool]; const winners: Array<{ userId: number; ticket: Ticket }> = []; while (remaining.length && winners.length < draw.winnerCount) { const ticket = remaining[crypto.getRandomValues(new Uint32Array(1))[0] % remaining.length]; winners.push({ userId: ticket.userId, ticket }); for (let i = remaining.length - 1; i >= 0; i--) if (remaining[i].userId === ticket.userId) remaining.splice(i, 1); } draw.winnerIds = winners.map((w) => w.userId); draw.winningEntryIds = winners.map((w) => w.ticket.id); draw.completedAt = stamp(); await write(`draw:${draw.id}`, draw); return { draw, winners }; }
export async function recordPayout(drawId: string, ownerId: number, amount: string, currency: string, transaction?: string): Promise<Payout | undefined> { const draw = await read<Draw>(`draw:${drawId}`); if (!draw || draw.ownerId !== ownerId || !draw.winnerIds.length) return undefined; const existing = await read<string[]>(`draw:${drawId}:payouts`) ?? []; const index = existing.length; if (index >= draw.winnerIds.length) return undefined; const payout: Payout = { id: makeId("payout"), userId: draw.winnerIds[index], drawId, winningEntryId: draw.winningEntryIds[index], amount, currency, detectionIds: [], transaction: transaction || undefined, operatorId: ownerId, recordedAt: stamp(), status: "recorded", kind: "manual" }; await write(`payout:${payout.id}`, payout); await addToIndex(`draw:${drawId}:payouts`, payout.id); await addToIndex(`user:${payout.userId}:payouts`, payout.id); await audit(ownerId, "manual-payout-recorded", payout.id); return payout; }
export async function completePayout(payoutId: string, ownerId: number): Promise<Payout | undefined> { const payout = await read<Payout>(`payout:${payoutId}`); if (!payout) return undefined; if (payout.kind === "manual") { const draw = payout.drawId && await read<Draw>(`draw:${payout.drawId}`); if (!draw || draw.ownerId !== ownerId) return undefined; payout.status = "completed"; } else { if (!await claimOperator(ownerId)) return undefined; payout.status = "sent"; } payout.completedAt = stamp(); payout.processedAt = stamp(); await write(`payout:${payout.id}`, payout); await audit(ownerId, "payout-completed", payout.id); return payout; }
export async function payoutQueue(): Promise<Payout[]> { const ids = (await read<string[]>("payout-queue")) ?? []; return (await Promise.all(ids.map((id) => read<Payout>(`payout:${id}`)))).filter((x): x is Payout => x !== undefined && x.status === "queued"); }
export async function payoutsForUser(userId: number): Promise<Payout[]> { const ids = (await read<string[]>(`user:${userId}:payouts`)) ?? []; return (await Promise.all(ids.map((id) => read<Payout>(`payout:${id}`)))).filter((x): x is Payout => Boolean(x)); }
