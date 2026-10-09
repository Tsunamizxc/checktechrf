let tokenCache = { value: "", until: 0 };
let warned = false;

async function adsToken() {
  const clientId = process.env.VK_CLIENT_ID || "";
  const clientSecret = process.env.VK_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return "";
  if (tokenCache.value && tokenCache.until > Date.now()) return tokenCache.value;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetch("https://ads.vk.com/api/v2/oauth2/token.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error(data.message || data.error || "VK Ads не выдал токен");
  }
  tokenCache = {
    value: data.access_token,
    until: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000,
  };
  return tokenCache.value;
}

async function sendVk(text) {
  const communityToken = process.env.VK_API_TOKEN || "";
  const userId = String(process.env.VK_NOTIFY_USER_ID || "").replace(/\D/g, "");
  if (communityToken && userId) {
    const body = new URLSearchParams({
      access_token: communityToken,
      v: "5.199",
      user_id: userId,
      random_id: String(Date.now()),
      message: text.slice(0, 3500),
    });
    const response = await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await response.json().catch(() => ({}));
    if (data.error) throw new Error(data.error.error_msg || "VK не отправил сообщение");
    return;
  }

  if (!process.env.VK_CLIENT_ID || !process.env.VK_CLIENT_SECRET) return;
  await adsToken();
  if (!warned) {
    warned = true;
    console.log("VK Ads подключён. Личные сообщения, как на сайте, шлёт отдельный ключ сообщества: VK_API_TOKEN и VK_NOTIFY_USER_ID.");
  }
}

module.exports = { sendVk };
