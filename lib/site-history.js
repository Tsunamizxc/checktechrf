function siteUrl() {
  return String(process.env.SITE_URL || "").replace(/\/$/, "");
}

function postSite(path, payload) {
  const base = siteUrl();
  const secret = String(process.env.SITE_NOTIFY_SECRET || "");
  if (!base.startsWith("https://") || !secret) return;

  let target;
  try {
    target = new URL(path, base.endsWith("/") ? base : `${base}/`);
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
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  })
    .then((response) => {
      if (!response.ok) console.log("История на сайте:", response.status);
    })
    .catch((error) => {
      console.log("История на сайте:", error.message);
    });
}

function pushSiteHistory(item) {
  if (!item?.userId) return;
  postSite("/wp-json/avtodiagnost/v1/telegram-history", {
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
}

function deleteSiteHistory(item) {
  if (!item?.userId || !item?.id) return;
  postSite("/wp-json/avtodiagnost/v1/telegram-history-delete", {
    telegramId: item.userId,
    entryId: item.id,
  });
}

module.exports = { pushSiteHistory, deleteSiteHistory };
