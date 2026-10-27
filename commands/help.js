const { errorMessage } = require("../functions/errorMessage");
const { servicesButton, siteButton } = require("../components/webButton");
const { chatIdOf } = require("../functions/text");

async function helpCommand(bot, msg) {
  const chatId = chatIdOf(msg);

  try {
    const row = [servicesButton(msg)];
    const site = siteButton(msg);
    if (site) row.push(site);

    const siteLine = site ? "«Сайт» открывает сайт.\n" : "";
    await bot.sendMessage(
      chatId,
      `*Как оформить услугу*

${siteLine}«Услуги» открывает ОСАГО, КАСКО, дубликат ДК, проверку техосмотра, запись и договор.

ОСАГО и запись на техосмотр открывают те же виджеты, что на сайте. Проверка, дубликат и договор оплачиваются через Т-Банк. Договор после оплаты приходит PDF-файлом. Заявку по-прежнему можно оставить — её получают администраторы.

Команды:
/start — открыть меню
/notify — присылать заявки в этот чат
/help — эта подсказка`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [row] },
      }
    );
  } catch (error) {
    console.log(error);
    await errorMessage(bot, chatId);
  }
}

module.exports = { helpCommand };
