const fs = require("fs");
const os = require("os");
const path = require("path");
const { handleMessage } = require("./functions/handleMessage");
const { startServer } = require("./server");
const { setNotifier, setDocumentSender } = require("./lib/notify");
const { addOperator, adminUsernames } = require("./lib/operator");
const { confirmLogin } = require("./lib/site-login");

require("dotenv").config();

startServer();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token.startsWith("сюда_")) {
  console.log("В .env нет TELEGRAM_BOT_TOKEN. Страница работает, бот не запущен.");
} else {
  startBot(token);
}

async function bindAdmins(bot) {
  for (const username of adminUsernames()) {
    try {
      const chat = await bot.getChat(`@${username}`);
      if (!chat?.id) continue;
      if (addOperator(chat.id)) {
        await bot.sendMessage(chat.id, "Вы подключены как администратор: заявки будут приходить в личные сообщения.");
      }
    } catch (error) {
      console.log(`Администратор @${username} пока не писал боту. Заявки подключатся после /start.`);
    }
  }
}

function startBot(botToken) {
  const TelegramBot = require("node-telegram-bot-api");
  const bot = new TelegramBot(botToken, { polling: true });

  setNotifier((chatId, text) => bot.sendMessage(chatId, text));
  setDocumentSender(async (chatId, buffer, filename, caption) => {
    const file = path.join(os.tmpdir(), `${Date.now()}-${filename}`);
    fs.writeFileSync(file, buffer);
    try {
      await bot.sendDocument(chatId, file, { caption }, { filename, contentType: "application/pdf" });
    } finally {
      fs.unlink(file, () => {});
    }
  });
  bindAdmins(bot);

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

  bot.on("callback_query", async (query) => {
    try {
      const data = String(query.data || "");
      if (!data.startsWith("login:")) {
        await bot.answerCallbackQuery(query.id);
        return;
      }
      const from = query.from || {};
      const ok = await confirmLogin(data.slice("login:".length), {
        id: from.id,
        username: from.username || "",
        name: [from.first_name, from.last_name].filter(Boolean).join(" "),
      });
      await bot.answerCallbackQuery(query.id, { text: ok ? "Вход подтверждён" : "Ссылка устарела" });
      if (ok && query.message?.chat?.id) {
        await bot.sendMessage(query.message.chat.id, "Вход на сайт подтверждён. Вернитесь в браузер — кабинет откроется сам.");
      }
    } catch (error) {
      console.log(error);
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (answerError) {
        console.log(answerError.message);
      }
    }
  });

  bot.on("polling_error", (error) => {
    console.log(error.message || error);
  });
}
