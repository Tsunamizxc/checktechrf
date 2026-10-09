const { helpCommand } = require("../commands/help");
const { startCommand } = require("../commands/start");
const { saveOperator } = require("../lib/operator");
const { chatIdOf } = require("./text");

async function notifyCommand(bot, msg) {
  const chatId = chatIdOf(msg);
  saveOperator(chatId);
  await bot.sendMessage(chatId, "Заявки с сайта и из бота будут приходить в этот чат.");
}

const commandHandlers = new Map([
  ["/start", startCommand],
  ["/help", helpCommand],
  ["/notify", notifyCommand],
]);

const buttonHandlers = new Map([["Помощь", helpCommand]]);

async function handleMessage(bot, msg) {
  const text = msg.text || "";
  const command = text.split("@")[0];
  const handler = commandHandlers.get(command) || buttonHandlers.get(text);

  if (handler) {
    await handler(bot, msg);
    return;
  }

  if (text) {
    await bot.sendMessage(
      msg.chat.id,
      "Нажмите «Услуги», чтобы открыть КАСКО, ОСАГО, ДКП или проверку техосмотра."
    );
  }
}

module.exports = { handleMessage };
