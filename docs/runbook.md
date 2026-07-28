# SignalLottery runbook

Set `BOT_TOKEN` and configure secure storage before release. The database URL is
stored as `database/redis-url` in the selected provider; the bot never reads it
directly at runtime. Without secure storage the bot stays available but explains
that its protected services are not configured; it never stores entries in memory.

## Secure storage

Set `BOT_SECURE_STORAGE_TYPE` to `aws`, `gcp`, `azure`, or `vault`. Provider
location settings are non-secret deployment configuration: `AWS_REGION`,
`GCP_PROJECT_ID`, `AZURE_KEY_VAULT_URL`, or `VAULT_ADDR` with optional
`VAULT_KV_MOUNT`. Use a workload identity with least-privilege read/write access
to this bot's secret prefix; do not pass provider tokens or private keys through
bot configuration. AWS deployments additionally provide a SigV4 workload signer.
All provider calls use HTTPS and the providers' audit logs should be enabled.

On first deployment the bot migrates these legacy environment values, tags each
stored value as rotated, and then ignores the legacy value forever:
`REDIS_URL`, `DATABASE_CREDENTIALS`, `WALLET_PRIVATE_KEYS`,
`PAYOUT_SIGNING_KEYS`, `CRYPTO_PAYOUT_CREDENTIALS`, `EXCHANGE_API_KEYS`,
`DEVICE_AUTH_TOKENS`, `THIRD_PARTY_API_KEYS`, and `JWT_SIGNING_KEYS`. Remove
those legacy deployment variables after the migration. Crypto signing must use
Azure Key Vault keys or Vault Transit through `secureStore().sign()`; raw private
keys are intentionally not exposed to handlers, logs, or durable records.

Secret reads are cached for five minutes by default (`SECURE_STORAGE_CACHE_TTL_MS`)
and callers can request an on-demand refresh with `secureStore().get(name, true)`.
Provider failures are contained and shown to users as the setup message rather
than leaking credentials or response details.

The first person to open **Owner controls** becomes the operator. They add monitored signals, schedule each weekly draw for Sunday 23:59 UTC, and choose the winner count (three is the default). At draw time, open **Owner controls → Run due draws**. The draw closes entry intake, selects distinct winners weighted by their entries, notifies each winner, and posts a non-sensitive summary in the operator's announcement chat.

Users must opt in and use **Link device** before a bridge report can earn an entry. The bridge format is `signal:<signal-id>:<device-id>:<unique-detection-id>[:<UTC-ISO-time>]`. Replaying the same detection ID cannot create a second entry.

For manual crypto settlement, use **Owner controls → Record payout**, select the completed draw, enter `amount | currency | optional transaction hash`, then tap **Mark complete** after the transfer clears. Winners can view their own records from **Payout history**.

Before release, run `npm run build`, `npm test`, and `npm run build:worker`. The dialog suite covers safe configuration fallback; production acceptance should additionally exercise one linked-device report, a due draw, and a completed payout against Redis.
