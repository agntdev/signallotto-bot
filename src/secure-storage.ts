/**
 * Provider-neutral secret access. Domain handlers never read credentials from
 * process.env: deployment supplies an ambient workload identity and this module
 * exchanges it with the selected secret manager over TLS.
 */
export type SecureStorageType = "aws" | "gcp" | "azure" | "vault";

export class SecureStorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SecureStorageError";
  }
}

export interface SecureSecretProvider {
  get(name: string): Promise<string | undefined>;
  put(name: string, value: string, metadata: Record<string, string>): Promise<void>;
  /** Signing is deliberately provider-side: callers never receive a private key. */
  sign?(keyName: string, digest: Uint8Array): Promise<Uint8Array>;
}

/** Supplied by the deployment integration, not by a bot message or config file. */
export interface WorkloadIdentity {
  bearerToken(provider: Exclude<SecureStorageType, "aws">): Promise<string>;
  signedAwsRequest?(request: Request): Promise<Request>;
}

declare global {
  // The hosting adapter may install this with workload/managed identity tokens.
  // It intentionally has no relation to application secrets.
  // eslint-disable-next-line no-var
  var __SIGNAL_LOTTERY_WORKLOAD_IDENTITY__: WorkloadIdentity | undefined;
}

const encoded = (name: string) => encodeURIComponent(name.replace(/^\/+/, ""));
const json = async (response: Response): Promise<Record<string, unknown>> => {
  if (!response.ok) throw new SecureStorageError("The secure storage provider rejected the request.");
  return await response.json() as Record<string, unknown>;
};
const optionalJson = async (response: Response): Promise<Record<string, unknown> | undefined> => {
  if (response.status === 404) return undefined;
  return json(response);
};
// GCP secret IDs and Azure Key Vault secret names cannot contain `/` or `_`.
const providerName = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
const providerLabels = (metadata: Record<string, string>) => Object.fromEntries(
  Object.entries(metadata).map(([key, value]) => [providerName(key), providerName(value).slice(0, 63)]),
);
const identity = (): WorkloadIdentity => {
  const value = globalThis.__SIGNAL_LOTTERY_WORKLOAD_IDENTITY__;
  if (!value) throw new SecureStorageError("Secure storage needs a workload identity. Ask the owner to finish provider setup.");
  return value;
};

class GcpSecretManager implements SecureSecretProvider {
  constructor(private readonly project: string) {}
  private url(name: string, suffix: string) { return `https://secretmanager.googleapis.com/v1/projects/${encoded(this.project)}/secrets/${encoded(providerName(name))}/versions/${suffix}`; }
  async get(name: string): Promise<string | undefined> {
    const token = await identity().bearerToken("gcp");
    const body = await optionalJson(await fetch(this.url(name, "latest:access"), { headers: { authorization: `Bearer ${token}` } }));
    if (!body) return undefined;
    const payload = body.payload as { data?: string } | undefined;
    return payload?.data ? new TextDecoder().decode(Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0))) : undefined;
  }
  async put(name: string, value: string, metadata: Record<string, string>): Promise<void> {
    const token = await identity().bearerToken("gcp");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    // Creation is idempotent at the caller level: an existing secret simply gets a new version.
    const secretName = providerName(name);
    const create = await fetch(`https://secretmanager.googleapis.com/v1/projects/${encoded(this.project)}/secrets?secretId=${encoded(secretName)}`, { method: "POST", headers, body: JSON.stringify({ labels: providerLabels(metadata) }) });
    if (!create.ok && create.status !== 409) await json(create);
    await json(await fetch(`https://secretmanager.googleapis.com/v1/projects/${encoded(this.project)}/secrets/${encoded(secretName)}:addVersion`, { method: "POST", headers, body: JSON.stringify({ payload: { data: btoa(String.fromCharCode(...new TextEncoder().encode(value))) } }) }));
  }
}

class AzureKeyVault implements SecureSecretProvider {
  constructor(private readonly vaultUrl: string) {}
  private url(name: string) { return `${this.vaultUrl.replace(/\/$/, "")}/secrets/${encoded(providerName(name))}?api-version=7.4`; }
  async get(name: string): Promise<string | undefined> {
    const token = await identity().bearerToken("azure");
    const body = await optionalJson(await fetch(this.url(name), { headers: { authorization: `Bearer ${token}` } }));
    if (!body) return undefined;
    return typeof body.value === "string" ? body.value : undefined;
  }
  async put(name: string, value: string, metadata: Record<string, string>): Promise<void> {
    const token = await identity().bearerToken("azure");
    await json(await fetch(this.url(name), { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ value, tags: providerLabels(metadata) }) }));
  }
  async sign(keyName: string, digest: Uint8Array): Promise<Uint8Array> {
    const token = await identity().bearerToken("azure");
    const url = `${this.vaultUrl.replace(/\/$/, "")}/keys/${encoded(keyName)}/sign?api-version=7.4`;
    const body = await json(await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ alg: "ES256", value: btoa(String.fromCharCode(...digest)) }) }));
    if (typeof body.value !== "string") throw new SecureStorageError("The key vault did not return a signature.");
    return Uint8Array.from(atob(body.value), (c) => c.charCodeAt(0));
  }
}

class Vault implements SecureSecretProvider {
  constructor(private readonly address: string, private readonly mount: string) {}
  private url(name: string) { return `${this.address.replace(/\/$/, "")}/v1/${encoded(this.mount)}/data/${encoded(name)}`; }
  async get(name: string): Promise<string | undefined> {
    const token = await identity().bearerToken("vault");
    const body = await json(await fetch(this.url(name), { headers: { "X-Vault-Token": token } }));
    const data = body.data as { data?: { value?: string } } | undefined;
    return data?.data?.value;
  }
  async put(name: string, value: string, metadata: Record<string, string>): Promise<void> {
    const token = await identity().bearerToken("vault");
    await json(await fetch(this.url(name), { method: "POST", headers: { "X-Vault-Token": token, "content-type": "application/json" }, body: JSON.stringify({ data: { value, ...metadata } }) }));
  }
  async sign(keyName: string, digest: Uint8Array): Promise<Uint8Array> {
    const token = await identity().bearerToken("vault");
    const url = `${this.address.replace(/\/$/, "")}/v1/transit/sign/${encoded(keyName)}`;
    const body = await json(await fetch(url, { method: "POST", headers: { "X-Vault-Token": token, "content-type": "application/json" }, body: JSON.stringify({ input: btoa(String.fromCharCode(...digest)) }) }));
    const signed = (body.data as { signature?: string } | undefined)?.signature;
    if (!signed) throw new SecureStorageError("Vault did not return a signature.");
    return new TextEncoder().encode(signed); // Vault's verifiable signature envelope, never a private key.
  }
}

class AwsSecretsManager implements SecureSecretProvider {
  constructor(private readonly region: string) {}
  private async request(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const raw = new Request(`https://secretsmanager.${this.region}.amazonaws.com/`, { method: "POST", headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `secretsmanager.${action}` }, body: JSON.stringify(payload) });
    const signer = identity().signedAwsRequest;
    if (!signer) throw new SecureStorageError("AWS Secrets Manager needs a SigV4 workload signer.");
    return json(await fetch(await signer(raw)));
  }
  async get(name: string): Promise<string | undefined> { const body = await this.request("GetSecretValue", { SecretId: name }); return typeof body.SecretString === "string" ? body.SecretString : undefined; }
  async put(name: string, value: string, metadata: Record<string, string>): Promise<void> {
    try { await this.request("CreateSecret", { Name: name, SecretString: value, Tags: Object.entries(metadata).map(([Key, Value]) => ({ Key, Value })) }); }
    catch { await this.request("PutSecretValue", { SecretId: name, SecretString: value }); }
  }
}

class CachedSecretStore {
  private readonly cache = new Map<string, { value: string | undefined; expires: number }>();
  constructor(private readonly provider: SecureSecretProvider, private readonly ttlMs: number) {}
  async get(name: string, refresh = false): Promise<string | undefined> {
    const found = this.cache.get(name);
    if (!refresh && found && found.expires > Date.now()) return found.value;
    const value = await this.provider.get(name);
    this.cache.set(name, { value, expires: Date.now() + this.ttlMs });
    return value;
  }
  async put(name: string, value: string, metadata: Record<string, string>): Promise<void> { await this.provider.put(name, value, metadata); this.cache.delete(name); }
  async sign(keyName: string, digest: Uint8Array): Promise<Uint8Array> { if (!this.provider.sign) throw new SecureStorageError("This secure storage provider cannot sign with a managed key."); return this.provider.sign(keyName, digest); }
}

const legacyNames: Record<string, string> = {
  REDIS_URL: "database/redis-url", DATABASE_CREDENTIALS: "database/credentials",
  WALLET_PRIVATE_KEYS: "crypto/wallet-private-keys", PAYOUT_SIGNING_KEYS: "crypto/payout-signing-keys",
  CRYPTO_PAYOUT_CREDENTIALS: "crypto/payout-credentials", EXCHANGE_API_KEYS: "exchange/api-keys",
  DEVICE_AUTH_TOKENS: "devices/auth-tokens", THIRD_PARTY_API_KEYS: "third-party/api-keys", JWT_SIGNING_KEYS: "auth/jwt-signing-keys",
};

export interface SecureStore { get(name: string, refresh?: boolean): Promise<string | undefined>; put(name: string, value: string, metadata: Record<string, string>): Promise<void>; sign(keyName: string, digest: Uint8Array): Promise<Uint8Array>; }
let singleton: SecureStore | undefined;

export async function secureStore(): Promise<SecureStore> {
  if (singleton) return singleton;
  const config: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env;
  const kind = config.BOT_SECURE_STORAGE_TYPE?.toLowerCase() as SecureStorageType | undefined;
  if (!kind || !["aws", "gcp", "azure", "vault"].includes(kind)) throw new SecureStorageError("Secure storage is not configured.");
  const required = (value: string | undefined, label: string): string => {
    if (!value) throw new SecureStorageError(`Secure storage needs ${label}.`);
    return value;
  };
  const provider = kind === "aws" ? new AwsSecretsManager(config.AWS_REGION ?? "us-east-1")
    : kind === "gcp" ? new GcpSecretManager(required(config.GCP_PROJECT_ID, "GCP_PROJECT_ID"))
    : kind === "azure" ? new AzureKeyVault(required(config.AZURE_KEY_VAULT_URL, "AZURE_KEY_VAULT_URL"))
    : new Vault(required(config.VAULT_ADDR, "VAULT_ADDR"), config.VAULT_KV_MOUNT ?? "secret");
  singleton = new CachedSecretStore(provider, Math.max(1_000, Number(config.SECURE_STORAGE_CACHE_TTL_MS ?? "300000")));
  await migrateLegacySecrets(singleton, config);
  return singleton;
}

/** Deployment-only compatibility migration. Legacy values are never read by bot features. */
export async function migrateLegacySecrets(store: SecureStore, env: Record<string, string | undefined>): Promise<void> {
  const marker = "signal-lottery/migrations/legacy-env-v1";
  if (await store.get(marker)) return;
  for (const [legacy, name] of Object.entries(legacyNames)) {
    const value = env[legacy];
    if (value) await store.put(name, value, { rotated: "true", migrated_from: "legacy-env", migrated_at: new Date().toISOString() });
  }
  await store.put(marker, "complete", { rotated: "true", migration: "legacy-env-v1" });
}

export function _resetSecureStoreForTests(): void { singleton = undefined; }
