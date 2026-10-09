const { servicesButton, siteButton } = require("./webButton");

function replyKeyboard(msg) {
  const services = servicesButton(msg);
  const site = siteButton(msg);
  const keyboard = [[{ text: services.text, web_app: services.web_app }]];

  if (site) keyboard.push([{ text: site.text, web_app: site.web_app }]);
  keyboard.push([{ text: "Помощь" }]);

  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
  };
}

module.exports = { replyKeyboard };
