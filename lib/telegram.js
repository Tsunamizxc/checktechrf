const crypto = require("crypto");

function userFromInitData(initData) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!initData || !token || token.startsWith("сюда_")) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const checkString = [...params.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const expected = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (expected.length !== hash.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !user.id) return null;
    return { id: Number(user.id), name: String(user.first_name || "") };
  } catch (error) {
    return null;
  }
}

module.exports = { userFromInitData };
