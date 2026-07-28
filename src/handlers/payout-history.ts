import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { payoutsForUser, StoreUnavailable } from "../lottery-store.js";

registerMainMenuItem({ label: "Payout history", data: "payouts:mine", order: 45 });
const composer = new Composer<Ctx>();
composer.callbackQuery("payouts:mine", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const payouts = await payoutsForUser(ctx.from.id);
    const text = payouts.length ? payouts.slice(0, 5).map((p) => `${p.amount} ${p.currency} — ${p.status === "completed" ? "completed" : "recorded"}`).join("\n") : "No payouts yet — winning entries will appear here after the draw.";
    await ctx.editMessageText(text, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
  } catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage."); else throw error; }
});
export default composer;
