const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "data", "operator.json");

function operatorChat() {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return String(data.chatId || "");
  } catch (error) {
    return "";
  }
}

function saveOperator(chatId) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ chatId: String(chatId) }));
}

module.exports = { operatorChat, saveOperator };
