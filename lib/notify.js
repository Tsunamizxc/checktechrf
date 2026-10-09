let send = async () => {};

function setNotifier(fn) {
  send = fn;
}

async function notify(chatId, text) {
  if (!chatId || !text) return;
  try {
    await send(chatId, text);
  } catch (error) {
    console.log(error.message || error);
  }
}

module.exports = { setNotifier, notify };
