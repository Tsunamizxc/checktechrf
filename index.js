const { handleMessage } = require("./functions/handleMessage");
const { startServer } = require("./server");
const { setNotifier } = require("./lib/notify");

require("dotenv").config();

startServer();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token.startsWith("сюда_")) {
  console.log("В .env нет TELEGRAM_BOT_TOKEN. Страница работает, бот не запущен.");
} else {
  startBot(token);
}

function startBot(botToken) {
  const TelegramBot = require("node-telegram-bot-api");
  const bot = new TelegramBot(botToken, { polling: true });

  setNotifier((chatId, text) => bot.sendMessage(chatId, text));

  function paintButton(button) {
    if (!button || button.style || button.request_contact) return button;
    return { ...button, style: "primary" };
  }

  function paintMarkup(markup) {
    if (!markup) return markup;
    if (Array.isArray(markup.keyboard)) {
      return {
        ...markup,
        keyboard: markup.keyboard.map((row) => row.map(paintButton)),
      };
    }
    return markup;
  }

  const sendMessage = bot.sendMessage.bind(bot);
  bot.sendMessage = (chatId, text, options = {}) => {
    if (options.reply_markup) {
      options = { ...options, reply_markup: paintMarkup(options.reply_markup) };
    }
    return sendMessage(chatId, text, options);
  };

  bot
    .setMyCommands([
      { command: "start", description: "Открыть меню" },
      { command: "help", description: "Как оформить услугу" },
      { command: "notify", description: "Присылать заявки в этот чат" },
    ])
    .catch((error) => console.log(error));

  bot.on("message", async (msg) => {
    try {
      await handleMessage(bot, msg);
    } catch (error) {
      console.log(error);
    }
  });

  bot.on("polling_error", (error) => {
    console.log(error.message || error);
  });
}
