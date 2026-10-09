const { errorMarkdown } = require("./errorMarkdown");

async function errorMessage(bot, chatId) {
  await bot.sendMessage(chatId, errorMarkdown());
}

module.exports = { errorMessage };
