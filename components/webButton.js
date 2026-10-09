require("dotenv").config();

function pageUrl(base, firstName, userId) {
  try {
    const url = new URL(base);
    if (firstName) url.searchParams.set("userName", firstName);
    if (userId) url.searchParams.set("userId", String(userId));
    return url.toString();
  } catch (error) {
    console.log(error);
    return base;
  }
}

function servicesButton(msg) {
  const port = process.env.PORT || 8791;
  const raw = process.env.WEB_APP_URL || `http://127.0.0.1:${port}/`;
  const firstName = msg.from?.first_name || "";
  const userId = msg.from?.id || "";

  return {
    text: "Услуги",
    web_app: { url: pageUrl(raw, firstName, userId) },
  };
}

function siteButton(msg) {
  const raw = process.env.SITE_URL || "";
  if (!raw.startsWith("https://")) return null;
  const firstName = msg.from?.first_name || "";
  const userId = msg.from?.id || "";

  return {
    text: "Сайт",
    web_app: { url: pageUrl(raw, firstName, userId) },
  };
}

module.exports = { servicesButton, siteButton };
