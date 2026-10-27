function siteUrl() {
  return String(process.env.SITE_URL || "").replace(/\/$/, "");
}

function pushSiteHistory(item) {
  const base = siteUrl();
  const secret = String(process.env.SITE_NOTIFY_SECRET || "");
  if (!base.startsWith("https://") || !secret || !item?.userId) return;

  const body = JSON.stringify({
    telegramId: item.userId,
    username: item.username || "",
    name: item.name || "",
    entry: {
      id: item.id,
      type: item.type,
      title: item.title,
      query: item.query,
      result: item.result,
      status: item.status,
      paid: item.paid,
      createdAt: item.createdAt,
      cards: item.cards || [],
    },
  });

  let target;
  try {
    target = new URL("/wp-json/avtodiagnost/v1/telegram-history", base.endsWith("/") ? base : `${base}/`);
  } catch (error) {
    console.log("История на сайте:", error.message);
    return;
  }

  fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Notify-Secret": secret,
    },
    body,
    signal: AbortSignal.timeout(8000),
  })
    .then((response) => {
      if (!response.ok) console.log("История на сайте:", response.status);
    })
    .catch((error) => {
      console.log("История на сайте:", error.message);
    });
}

module.exports = { pushSiteHistory };
