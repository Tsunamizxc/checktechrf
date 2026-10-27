const { errorMessage } = require("./errorMessage");
const { replyKeyboard } = require("../components/replyKeyboard");
const { siteButton } = require("../components/webButton");
const { chatIdOf } = require("./text");

async function handleWebApp(bot, msg) {
  const chatId = chatIdOf(msg);

  if (!process.env.ADMIN_CHAT_ID) {
    console.log(`chat id для ADMIN_CHAT_ID: ${chatId}`);
  }

  try {
    const siteLine = siteButton(msg)
      ? "«Сайт» открывает сайт в Mini App. "
      : "";
    await bot.sendMessage(
      chatId,
      `Проверка техосмотра\n\n${siteLine}«Услуги» — заявка на КАСКО, ОСАГО, договор или проверку техосмотра. Заявку получают администраторы.`,
      { reply_markup: replyKeyboard(msg) }
    );
  } catch (error) {
    console.log(error);
    errorMessage(bot, chatId);
  }
}

module.exports = { handleWebApp };
