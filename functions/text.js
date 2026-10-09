function chatIdOf(msg) {
  return msg.chat?.id || msg.message?.chat?.id || msg.from?.id;
}

module.exports = { chatIdOf };
