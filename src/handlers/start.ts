import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, mainMenuKeyboard } from "../toolkit/index.js";
import { setOptIn, touchUser, StoreUnavailable } from "../lottery-store.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

const WELCOME = "Welcome to SignalLottery.\n\nOpt in to location-based signal credits, then keep an eye on your entries.";

composer.command("start", async (ctx) => {
  if (!ctx.from) return;
  try {
    const user = await touchUser(ctx.from.id);
    await ctx.reply(user.locationOptIn ? WELCOME : "Welcome to SignalLottery.\n\nLocation stays off until you choose to earn signal credits.", {
      reply_markup: user.locationOptIn ? mainMenuKeyboard() : inlineKeyboard([[inlineButton("Enable signal credits", "privacy:opt-in")], [inlineButton("Open menu", "menu:main")]]),
    });
  } catch (error) {
    if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery's secure storage isn't set up yet. Ask the owner to finish provider setup.");
    else throw error;
  }
});

composer.callbackQuery("privacy:opt-in", async (ctx) => {
  await ctx.answerCallbackQuery();
  try { await setOptIn(ctx.from.id, true); await ctx.editMessageText("Signal credits are on. We only keep verified detections for dispute checks.", { reply_markup: mainMenuKeyboard() }); }
  catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery's secure storage isn't set up yet. Ask the owner to finish provider setup."); else throw error; }
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;
