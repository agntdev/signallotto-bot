import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { ticketsFor, StoreUnavailable, touchUser } from "../lottery-store.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "View Balance", data: "balance:show" }) if the toolkit exposes it.

registerMainMenuItem({ label: "View balance", data: "balance:show", order: 20 });
const composer = new Composer<Ctx>();

composer.callbackQuery("balance:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const user = await touchUser(ctx.from.id); const tickets = await ticketsFor(ctx.from.id);
    await ctx.editMessageText(user.locationOptIn ? `You have ${tickets.length} active ${tickets.length === 1 ? "entry" : "entries"}.` : "Signal credits are off. Enable them to start earning entries.", { reply_markup: inlineKeyboard([[inlineButton(user.locationOptIn ? "Pause credits" : "Enable credits", user.locationOptIn ? "pause:start" : "privacy:opt-in")], [inlineButton("Back to menu", "menu:main")]]) });
  } catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage."); else throw error; }
});

export default composer;
