const { notify } = require("./notify");
const { sendMail } = require("./mail");
const { sendVk } = require("./vk");
const { operatorChat } = require("./operator");

function chats() {
  const raw = [process.env.ADMIN_CHAT_ID, process.env.TELEGRAM_NOTIFY_CHATS, operatorChat()]
    .filter(Boolean)
    .join(",");
  return [...new Set(raw.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

async function deliver(text, subject, channels = {}) {
  const title = subject || "Новая заявка";
  const full = text.startsWith(title) ? text : `${title}\n\n${text}`;
  const sendTelegram = channels.telegram !== false;
  const sendEmail = channels.mail !== false;
  const sendVkMessage = channels.vk !== false;

  if (sendTelegram) {
    await Promise.all(chats().map((chatId) => notify(chatId, full)));
  }
  if (sendEmail) {
    try {
      await sendMail(title, full);
    } catch (error) {
      console.log("Почта:", error.message);
    }
  }
  if (sendVkMessage) {
    try {
      await sendVk(full);
    } catch (error) {
      console.log("VK:", error.message);
    }
  }
}

module.exports = { deliver };
