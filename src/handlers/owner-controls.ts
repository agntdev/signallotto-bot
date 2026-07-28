import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { addSignal, createDraw, drawsForOwner, markPaid, now, runDraw, StoreUnavailable } from "../lottery-store.js";

registerMainMenuItem({ label: "Owner controls", data: "owner:menu", order: 50 });
const composer = new Composer<Ctx>();
const ownerMenu = inlineKeyboard([[inlineButton("Add signal", "owner:signal")], [inlineButton("Schedule draw", "owner:draw")], [inlineButton("Settle payout", "owner:payout")], [inlineButton("Back to menu", "menu:main")]]);
const unavailable = async (ctx: Ctx) => ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage.");

composer.callbackQuery("owner:menu", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText("Owner controls are tied to the account that creates each draw.", { reply_markup: ownerMenu }); });
composer.callbackQuery("owner:signal", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "add-signal"; await ctx.reply("Send the frequency, radius in metres, and window in minutes.\nExample: 99.5 MHz, 250, 30"); });
composer.callbackQuery("owner:draw", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "schedule-draw"; await ctx.reply("Send the prize and UTC date-time.\nExample: 0.01 BTC | 2030-01-01T12:00:00Z"); });
composer.callbackQuery("owner:payout", async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const draws = await drawsForOwner(ctx.from.id); const owned = draws.filter((d) => d.winnerId && d.payoutStatus === "pending");
    if (!owned.length) return ctx.reply("No unpaid winning draws are ready to settle.");
    await ctx.editMessageText("Choose the draw you paid.", { reply_markup: inlineKeyboard([...owned.map((d) => [inlineButton(`Mark ${d.prize} paid`, `owner:pay:${d.id}`)]), [inlineButton("Back", "owner:menu")]]) });
  } catch (error) { if (error instanceof StoreUnavailable) await unavailable(ctx); else throw error; }
});
composer.callbackQuery(/^owner:pay:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "payout"; ctx.session.draft = { drawId: ctx.match[1] }; await ctx.reply("Send the transaction reference to record this manual payout."); });
composer.callbackQuery(/^owner:run:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const result = await runDraw(ctx.match[1], ctx.from.id); const text = result.reason === "early" ? "That draw isn't due yet." : result.reason === "empty" ? "No valid entries landed in this draw, so no winner was selected." : result.winner ? `The draw is complete. The winner has been notified privately.` : "That draw isn't available to this account."; await ctx.reply(text); if (result.winner && result.draw) { try { await ctx.api.sendMessage(result.winner, `You won ${result.draw.prize}! The owner will arrange your manual crypto payout.`); } catch { /* A blocked recipient must not stop the draw. */ } } }
  catch (error) { if (error instanceof StoreUnavailable) await unavailable(ctx); else throw error; }
});
composer.command("payout", async (ctx) => { await ctx.reply("Open Owner controls, then tap Settle payout to record a completed transfer.", { reply_markup: ownerMenu }); });

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  try {
    if (ctx.session.step === "add-signal") { const parts = text.split(",").map((x) => x.trim()); const radius = Number(parts[1]); const window = Number(parts[2]); if (parts.length !== 3 || !parts[0] || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(window) || window <= 0) return ctx.reply("Use a frequency, a positive radius, and a positive window. Try the example above."); await addSignal(parts[0], radius, window); ctx.session.step = undefined; return ctx.reply("That signal is now monitored.", { reply_markup: ownerMenu }); }
    if (ctx.session.step === "schedule-draw") { const [prize, when] = text.split("|").map((x) => x.trim()); const date = new Date(when); if (!prize || !when || Number.isNaN(date.getTime()) || date.getTime() <= now().getTime()) return ctx.reply("Send a future UTC date-time in the format shown above."); const draw = await createDraw(ctx.from.id, prize, date.toISOString()); ctx.session.step = undefined; return ctx.reply("Your draw is scheduled. Open Upcoming draws to see it.", { reply_markup: inlineKeyboard([[inlineButton("Open draws", "draws:upcoming")], [inlineButton("Run draw when due", `owner:run:${draw.id}`)]]) }); }
    if (ctx.session.step === "payout") { const id = ctx.session.draft?.drawId; if (!id || !text) return ctx.reply("Send the transaction reference to finish this payout."); const draw = await markPaid(id, ctx.from.id, text); if (!draw) return ctx.reply("That payout can't be updated from this account."); ctx.session.step = undefined; ctx.session.draft = undefined; return ctx.reply("Payout recorded. Nice work closing the loop.", { reply_markup: ownerMenu }); }
  } catch (error) { if (error instanceof StoreUnavailable) return unavailable(ctx); throw error; }
  return next();
});

export default composer;
