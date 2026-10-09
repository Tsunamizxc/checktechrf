const { handleWebApp } = require("../functions/handleWebApp");

async function startCommand(bot, msg) {
  await handleWebApp(bot, msg);
}

module.exports = { startCommand };
