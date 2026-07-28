import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { detect, StoreUnavailable } from "../lottery-store.js";

/** Device bridge events: signal:<configured-signal>:<linked-device>:<unique-detection-id>[:UTC ISO time]. */
const composer = new Composer<Ctx>();

composer.hears(/^signal:([a-z0-9-]+):([a-zA-Z0-9_-]{3,48}):([a-zA-Z0-9_-]{6,96})(?::(.+))?$/, async (ctx) => {
  if (!ctx.from) return;
  try {
    const reportedAt = ctx.match[4] ? new Date(ctx.match[4]) : undefined;
    if (reportedAt && Number.isNaN(reportedAt.getTime())) return ctx.reply("That detection time isn't valid. Send it as a UTC ISO time.");
    const outcome = await detect(ctx.match[1], ctx.match[2], ctx.match[3], reportedAt?.toISOString());
    console.info("[signal-lottery] detection_processed", { result: outcome.result });
    const payoutLine = outcome.result === "issued" && outcome.payout === "pending" ? " A crypto payout is ready for operator settlement."
      : outcome.result === "issued" && outcome.payout === "queued" ? " Your crypto payout is queued with your next batch."
      : outcome.result === "issued" && outcome.payout === "wallet-required" ? " Link and verify a wallet to receive automatic crypto payouts."
      : outcome.result === "issued" && outcome.payout === "kyc-required" ? " This payout needs KYC review before settlement."
      : outcome.result === "issued" && outcome.payout === "daily-cap" ? " Today's payout limit is reached, so no crypto payout was added."
      : "";
    const text = outcome.result === "issued" ? `Signal credit logged for ${outcome.signal.name}. One entry landed at ${outcome.detectedAt} UTC; you now have ${outcome.totalEntries} entries in this draw.${payoutLine}`
      : outcome.result === "duplicate" ? "That signal was already credited recently. Your entry count is unchanged."
      : outcome.result === "paused" ? "Credits are paused. Resume them from the menu when you're ready."
      : outcome.result === "no-opt-in" ? "Location credits are off. Open /start and enable them before sending detections."
      : outcome.result === "no-draw" ? "That signal checked out, but there isn't a draw scheduled yet."
      : outcome.result === "unlinked" ? "That device isn't linked to a SignalLottery account, so no entry was issued."
      : "That signal isn't on the monitored list.";
    if (outcome.result === "issued") {
      // The bridge may report in another chat. Notify the opted-in account, and
      // never retry the credit itself if Telegram delivery is temporarily down.
      await sendConfirmation(ctx, outcome.userId, text);
    } else await ctx.reply(text);
  } catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage."); else throw error; }
});

async function sendConfirmation(ctx: Ctx, userId: number, text: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await ctx.api.sendMessage(userId, text); console.info("[signal-lottery] notification_sent", { kind: "credit", attempt: attempt + 1 }); return; } catch { console.warn("[signal-lottery] notification_failed", { kind: "credit", attempt: attempt + 1 }); }
  }
}

export default composer;
