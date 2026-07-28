import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { detect, StoreUnavailable } from "../lottery-store.js";

/** Device bridge events are deliberately narrow: signal:<configured-signal>:<device-token>. */
const composer = new Composer<Ctx>();

composer.hears(/^signal:([a-z0-9-]+):([a-zA-Z0-9_-]{3,48})$/, async (ctx) => {
  if (!ctx.from) return;
  try {
    const outcome = await detect(ctx.from.id, ctx.match[1], ctx.match[2]);
    const text = outcome.result === "issued" ? `You earned an entry for ${outcome.draw.prize}. Good signal!`
      : outcome.result === "duplicate" ? "That signal was already credited recently. Your entry count is unchanged."
      : outcome.result === "paused" ? "Credits are paused. Resume them from the menu when you're ready."
      : outcome.result === "no-opt-in" ? "Location credits are off. Open /start and enable them before sending detections."
      : outcome.result === "no-draw" ? "That signal checked out, but there isn't a draw scheduled yet."
      : "That signal isn't on the monitored list.";
    await ctx.reply(text);
  } catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage."); else throw error; }
});

export default composer;
