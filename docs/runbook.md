# SignalLottery runbook

Set `BOT_TOKEN` and the durable `REDIS_URL` before release. Without Redis the bot stays available but explains that secure storage has not been configured; it never stores entries in memory.

The first person to open **Owner controls** becomes the operator. They add monitored signals, schedule each weekly draw for Sunday 23:59 UTC, and choose the winner count (three is the default). At draw time, open **Owner controls → Run due draws**. The draw closes entry intake, selects distinct winners weighted by their entries, notifies each winner, and posts a non-sensitive summary in the operator's announcement chat.

Users must opt in and use **Link device** before a bridge report can earn an entry. The bridge format is `signal:<signal-id>:<device-id>:<unique-detection-id>[:<UTC-ISO-time>]`. Replaying the same detection ID cannot create a second entry.

For manual crypto settlement, use **Owner controls → Record payout**, select the completed draw, enter `amount | currency | optional transaction hash`, then tap **Mark complete** after the transfer clears. Winners can view their own records from **Payout history**.

Before release, run `npm run build`, `npm test`, and `npm run build:worker`. The dialog suite covers safe configuration fallback; production acceptance should additionally exercise one linked-device report, a due draw, and a completed payout against Redis.
