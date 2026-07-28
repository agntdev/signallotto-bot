import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { setPaused, StoreUnavailable, touchUser } from "../lottery-store.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "Pause Credits", data: "pause:start" }) if the toolkit exposes it.

registerMainMenuItem({ label: "Pause credits", data: "pause:start", order: 30 });
const composer = new Composer<Ctx>();

composer.callbackQuery("pause:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const user = await touchUser(ctx.from.id); await setPaused(ctx.from.id, !user.creditsPaused);
    await ctx.editMessageText(user.creditsPaused ? "Credits are back on. Your next verified signal can earn an entry." : "Credits are paused. Verified signals won't create entries until you resume.", { reply_markup: inlineKeyboard([[inlineButton(user.creditsPaused ? "Pause credits" : "Resume credits", "pause:start")], [inlineButton("Back to menu", "menu:main")]]) });
  } catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage."); else throw error; }
});

export default composer;
