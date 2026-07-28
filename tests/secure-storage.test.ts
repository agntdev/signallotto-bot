import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetSecureStoreForTests, migrateLegacySecrets, secureStore } from "../src/secure-storage.js";

const originalFetch = globalThis.fetch;
const oldEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...oldEnv };
  delete globalThis.__SIGNAL_LOTTERY_WORKLOAD_IDENTITY__;
  _resetSecureStoreForTests();
});

describe("secure storage providers", () => {
  it.each([
    ["gcp", { GCP_PROJECT_ID: "project" }],
    ["azure", { AZURE_KEY_VAULT_URL: "https://vault.example" }],
    ["vault", { VAULT_ADDR: "https://vault.example" }],
    ["aws", { AWS_REGION: "us-east-1" }],
  ] as const)("uses the %s provider through the workload identity", async (kind, config) => {
    process.env = { ...oldEnv, BOT_SECURE_STORAGE_TYPE: kind, ...config };
    globalThis.__SIGNAL_LOTTERY_WORKLOAD_IDENTITY__ = {
      bearerToken: async () => "workload-token",
      signedAwsRequest: async (request) => request,
    };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(
      kind === "gcp" ? { payload: { data: btoa("redis://secure") } }
        : kind === "azure" ? { value: "redis://secure" }
          : kind === "vault" ? { data: { data: { value: "redis://secure" } } }
            : { SecretString: "redis://secure" },
    ), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    const store = await secureStore();
    await expect(store.get("database/redis-url")).resolves.toBe("redis://secure");
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("migrates legacy values once and marks them rotated", async () => {
    const values = new Map<string, string>();
    const store = {
      get: async (name: string) => values.get(name),
      put: async (name: string, value: string) => { values.set(name, value); },
      sign: async () => new Uint8Array(),
    };
    await migrateLegacySecrets(store, { REDIS_URL: "redis://legacy", JWT_SIGNING_KEYS: "old-key" });
    await migrateLegacySecrets(store, { REDIS_URL: "redis://changed" });
    expect(values.get("database/redis-url")).toBe("redis://legacy");
    expect(values.get("auth/jwt-signing-keys")).toBe("old-key");
    expect(values.get("signal-lottery/migrations/legacy-env-v1")).toBe("complete");
  });
});
