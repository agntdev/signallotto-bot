import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { linkWallet, StoreUnavailable, walletFor } from "../lottery-store.js";

registerMainMenuItem({ label: "Manage wallet", data: "wallet:menu", order: 44 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
const unavailable = (ctx: Ctx) => ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage.");

composer.callbackQuery("wallet:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const wallet = await walletFor(ctx.from.id);
    const text = !wallet ? "No payout wallet linked yet — add an ERC-20 or native-chain address to receive crypto rewards."
      : `Your payout wallet ending in ${wallet.address.slice(-4)} is ${wallet.verified ? "verified" : "waiting for operator verification"}.`;
    await ctx.editMessageText(text, { reply_markup: inlineKeyboard([[inlineButton(wallet ? "Change wallet" : "Link wallet", "wallet:link")], ...back.inline_keyboard]) });
  } catch (error) { if (error instanceof StoreUnavailable) await unavailable(ctx); else throw error; }
});
composer.callbackQuery("wallet:link", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "link-wallet";
  await ctx.reply("Send the wallet address you control. It will need operator verification before payouts can go out.", { reply_markup: { force_reply: true, input_field_placeholder: "0x…" } });
});
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "link-wallet") return next();
  const address = ctx.message.text.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return ctx.reply("That doesn't look like an EVM wallet address. Check it and try again.");
  try { await linkWallet(ctx.from.id, address); ctx.session.step = undefined; await ctx.reply("Your wallet is linked and waiting for verification. Your entries still keep rolling in.", { reply_markup: back }); }
  catch (error) { if (error instanceof StoreUnavailable) await unavailable(ctx); else throw error; }
});
export default composer;
