let send = async () => {};
let sendFile = async () => {};

function setNotifier(fn) {
  send = fn;
}

function setDocumentSender(fn) {
  sendFile = fn;
}

async function notify(chatId, text) {
  if (!chatId || !text) return;
  try {
    await send(chatId, text);
  } catch (error) {
    console.log(error.message || error);
  }
}

async function sendDocument(chatId, buffer, filename, caption) {
  if (!chatId || !buffer) return;
  try {
    await sendFile(chatId, buffer, filename, caption);
  } catch (error) {
    console.log(error.message || error);
  }
}

module.exports = { setNotifier, setDocumentSender, notify, sendDocument };
