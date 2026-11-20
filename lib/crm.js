const http = require("http");
const https = require("https");
const { domainToUnicode } = require("url");

const CHECK_TITLES = {
  check: "Проверка техосмотра",
  epts: "Проверка ЭПТС",
  rnis: "Проверка РНИС",
  mkad: "Пропуск МКАД",
  dkp: "Договор купли-продажи",
  dublikat: "Дубликат ДК",
  kasko: "КАСКО",
  osago: "ОСАГО",
  tehosmotr: "Запись на техосмотр",
  site: "Заявка с сайта",
};

function clip(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function siteHost(raw) {
  const value = clip(raw, 300);
  if (!value) return "";
  try {
    const host = new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./i, "");
    if (!host) return "";
    try {
      return domainToUnicode(host);
    } catch (error) {
      return host;
    }
  } catch (error) {
    return "";
  }
}

function resolvePageUrl(order, fields = {}) {
  return (
    clip(order.pageUrl || order.page_url || fields["Страница"] || fields.page || fields.site || process.env.SITE_URL || "", 300) ||
    "https://проверка-техосмотра.рф/"
  );
}

function pushLead(payload) {
  const urlRaw = String(process.env.CRM_URL || "").trim();
  const secret = String(process.env.CRM_SECRET || "").trim();
  if (!urlRaw || !secret) return Promise.resolve(false);

  let url;
  try {
    url = new URL(urlRaw);
  } catch (error) {
    console.log("CRM URL некорректен:", error.message);
    return Promise.resolve(false);
  }

  const body = Buffer.from(JSON.stringify(payload));
  const transport = url.protocol === "https:" ? https : http;
  const req = transport.request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.length,
        "X-CRM-Secret": secret,
      },
      timeout: 12000,
    },
    (res) => {
      res.resume();
      if (res.statusCode >= 400) {
        console.log("CRM HTTP:", res.statusCode);
      }
    }
  );

  req.on("error", (error) => {
    console.log("CRM:", error.message);
  });
  req.on("timeout", () => {
    req.destroy();
  });
  req.write(body);
  req.end();
  return Promise.resolve(true);
}

function reportText(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((row) => {
      if (!row || typeof row !== "object") return "";
      const label = clip(row.label, 80);
      const value = clip(row.value, 400);
      if (!label && !value) return "";
      return label ? `${label}: ${value}` : value;
    })
    .filter(Boolean)
    .join("\n");
}

function fromBotOrder(order, user, extra = {}) {
  const fields = { ...(order.fields || {}), ...(extra.fields || {}) };
  const service = order.service === "site" || order.source === "site" ? "site" : order.service;
  const title = CHECK_TITLES[service] || extra.type_label || service || "Заявка";
  const plate = clip(order.plate || fields.plate || fields.vehicle_plate || fields["Госномер"] || extra.plate, 32);
  const vin = clip(order.vin || fields.vin || fields.vehicle_vin || fields.query || fields.dkNumber || fields["VIN"] || extra.vin, 40);
  const query = clip(order.query || extra.query || [vin, plate].filter(Boolean).join(" / "), 180);
  const summary = clip(extra.summary || order.summary || "", 3500);
  const report = reportText(extra.report || order.report);
  const messageParts = [
    extra.message || fields.message || fields["Сообщение"] || "",
    summary,
    report,
  ].filter(Boolean);

  if (query && !messageParts.some((part) => part.includes(query))) {
    messageParts.unshift(`Запрос: ${query}`);
  }

  const isSite = service === "site" || order.source === "site";
  const pageUrl = isSite ? resolvePageUrl(order, fields) : clip(extra.page_url || fields["Страница"] || "", 300);
  const host = siteHost(pageUrl) || (isSite ? "проверка-техосмотра.рф" : "");

  return pushLead({
    source: isSite ? "site" : "telegram",
    type: isSite ? "site" : service,
    type_label: isSite && host ? `Заявка с сайта · ${host}` : title,
    subject: extra.subject || (isSite && host ? `Заявка с сайта · ${host}` : title),
    name: fields.name || fields.seller_name || fields["Имя"] || (user && user.name) || "",
    phone: fields.phone || fields["Телефон"] || "",
    email: fields.email || order.email || fields["Email"] || "",
    city: fields.city || fields["Город"] || "",
    telegram: clip((user && user.username) || order.username, 64).replace(/^@/, ""),
    telegram_id: String((user && user.id) || order.chatId || ""),
    car_brand: fields.brand || fields.vehicle_make || fields["Марка"] || "",
    car_model: fields.model || fields.vehicle_model || fields["Модель"] || "",
    car_year: fields.vehicle_year || fields["Год выпуска"] || "",
    plate,
    vin,
    message: messageParts.join("\n\n").slice(0, 5000),
    page: pageUrl,
    page_url: pageUrl,
    site: pageUrl,
    site_name: host,
    site_url: pageUrl,
    external_id: order.id,
    amount: order.amount || 0,
    order_status: order.status || "",
    event: extra.event || "",
    event_text: extra.event_text || "",
    fields: {
      ...fields,
      query,
      summary,
      report,
      service: service || "",
      found: extra.found == null ? "" : extra.found ? "да" : "нет",
      ...(host ? { Сайт: host } : {}),
      ...(pageUrl ? { Страница: pageUrl } : {}),
    },
  });
}

function fromApiCheck(order, result = {}) {
  return fromBotOrder(
    order,
    { id: order.chatId, username: order.username || "", name: "" },
    {
      event: "api_check",
      event_text: "Результат проверки API",
      subject: CHECK_TITLES[order.service] || "Проверка",
      summary: result.summary || order.summary || "",
      report: result.lines || order.report || [],
      query: result.query || order.query || "",
      found: result.found,
      plate: order.plate || "",
      vin: order.vin || "",
    }
  );
}

function fromSiteLead(order) {
  return fromBotOrder(order, null);
}

module.exports = { pushLead, fromBotOrder, fromSiteLead, fromApiCheck, CHECK_TITLES };
