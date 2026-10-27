const { helpCommand } = require("../commands/help");
const { startCommand } = require("../commands/start");
const { addOperator, adminUsernames } = require("../lib/operator");
const { chatIdOf } = require("./text");

async function notifyCommand(bot, msg) {
  const chatId = chatIdOf(msg);
  addOperator(chatId);
  await bot.sendMessage(chatId, "Заявки с сайта и из бота будут приходить в этот чат.");
}

function rememberAdmin(msg) {
  const username = String(msg.from?.username || "").replace(/^@/, "").toLowerCase();
  if (!username || !adminUsernames().includes(username)) return false;
  return addOperator(chatIdOf(msg));
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
  const registered = rememberAdmin(msg);

  if (handler) {
    await handler(bot, msg);
    if (registered) {
      await bot.sendMessage(chatIdOf(msg), "Вы подключены как администратор: заявки будут приходить в личные сообщения.");
    }
    return;
  }

  if (registered) {
    await bot.sendMessage(chatIdOf(msg), "Вы подключены как администратор: заявки будут приходить в личные сообщения.");
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
