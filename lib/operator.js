const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "data", "operator.json");

function readChats() {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(data.chats) ? data.chats : [];
    if (data.chatId) list.push(data.chatId);
    return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
  } catch (error) {
    return [];
  }
}

function writeChats(chats) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const unique = [...new Set(chats.map((item) => String(item).trim()).filter(Boolean))];
  fs.writeFileSync(file, JSON.stringify({ chats: unique, chatId: unique[0] || "" }));
  return unique;
}

function operatorChats() {
  return readChats();
}

function operatorChat() {
  return readChats()[0] || "";
}

function addOperator(chatId) {
  const id = String(chatId || "").trim();
  if (!id) return false;
  const chats = readChats();
  if (chats.includes(id)) return false;
  writeChats([...chats, id]);
  return true;
}

function adminUsernames() {
  return String(process.env.ADMIN_USERNAMES || "ros_propusk,texosmotr2026")
    .split(/[\s,;]+/)
    .map((item) => item.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

function adminChatIds() {
  return [
    ...new Set(
      [process.env.ADMIN_CHAT_ID, process.env.TELEGRAM_NOTIFY_CHATS, ...operatorChats()]
        .filter(Boolean)
        .join(",")
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function isAdminUser(user) {
  if (!user || !user.id) return false;
  const username = String(user.username || "").replace(/^@/, "").toLowerCase();
  if (username && adminUsernames().includes(username)) return true;
  return adminChatIds().includes(String(user.id));
}

module.exports = { operatorChat, operatorChats, addOperator, adminUsernames, adminChatIds, isAdminUser };
