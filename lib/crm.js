const http = require("http");
const https = require("https");

function clip(value, max = 500) {
  return String(value || "").trim().slice(0, max);
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
      timeout: 8000,
    },
    (res) => {
      res.resume();
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

function fromBotOrder(order, user) {
  const fields = order.fields || {};
  return pushLead({
    source: order.service === "site" || order.source === "site" ? "site" : "telegram",
    type: order.service === "site" ? "site" : order.service,
    subject: order.subject || "",
    name: fields.name || fields.seller_name || fields["Имя"] || (user && user.name) || "",
    phone: fields.phone || fields["Телефон"] || "",
    email: fields.email || order.email || fields["Email"] || "",
    city: fields.city || fields["Город"] || "",
    telegram: clip((user && user.username) || order.username, 64).replace(/^@/, ""),
    telegram_id: String((user && user.id) || order.chatId || ""),
    car_brand: fields.brand || fields.vehicle_make || fields["Марка"] || "",
    car_model: fields.model || fields.vehicle_model || fields["Модель"] || "",
    car_year: fields.vehicle_year || fields["Год выпуска"] || "",
    plate: fields.vehicle_plate || fields["Госномер"] || "",
    vin: fields.query || fields.vehicle_vin || fields.dkNumber || fields["VIN"] || "",
    message: fields.message || fields["Сообщение"] || "",
    external_id: order.id,
    amount: order.amount || 0,
    order_status: order.status || "",
    fields,
  });
}

function fromSiteLead(order) {
  return fromBotOrder(order, null);
}

module.exports = { pushLead, fromBotOrder, fromSiteLead };
