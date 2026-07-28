import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { upcomingDraws, StoreUnavailable } from "../lottery-store.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "Upcoming Draws", data: "draws:upcoming" }) if the toolkit exposes it.

registerMainMenuItem({ label: "Upcoming draws", data: "draws:upcoming", order: 40 });
const composer = new Composer<Ctx>();

composer.callbackQuery("draws:upcoming", async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const draws = await upcomingDraws();
    const text = draws.length ? draws.slice(0, 5).map((d) => `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(d.scheduledTime))} UTC — ${d.prize}`).join("\n") : "No draws are scheduled yet — check back after the next launch.";
    await ctx.editMessageText(text, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
  } catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage."); else throw error; }
});

export default composer;
