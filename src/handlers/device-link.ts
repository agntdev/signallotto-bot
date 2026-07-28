import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { devicesFor, linkDevice, StoreUnavailable } from "../lottery-store.js";

registerMainMenuItem({ label: "Link a device", data: "device:menu", order: 15 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

composer.callbackQuery("device:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const devices = await devicesFor(ctx.from.id);
    await ctx.editMessageText(devices.length ? `You have ${devices.length} linked ${devices.length === 1 ? "device" : "devices"}. Add another device when you're ready.` : "No devices linked yet — add the device that reports your verified signals.", { reply_markup: inlineKeyboard([[inlineButton("Link a device", "device:link")], ...back.inline_keyboard]) });
  } catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage."); else throw error; }
});
composer.callbackQuery("device:link", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "link-device"; await ctx.reply("Send your device ID. Use letters, numbers, dashes, or underscores only.", { reply_markup: { force_reply: true, input_field_placeholder: "Device ID" } }); });
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "link-device") return next();
  const deviceId = ctx.message.text.trim();
  if (!/^[a-zA-Z0-9_-]{3,48}$/.test(deviceId)) return ctx.reply("That device ID doesn't look right. Check it and try again.");
  try { const result = await linkDevice(ctx.from.id, deviceId); ctx.session.step = undefined; await ctx.reply(result === "linked" ? "Your device is linked. Its verified signals can now earn entries." : "That device is already linked to another account.", { reply_markup: back }); }
  catch (error) { if (error instanceof StoreUnavailable) await ctx.reply("SignalLottery isn't set up yet. Ask the owner to connect secure storage."); else throw error; }
});
export default composer;
