const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { catalog, formatPrice } = require("./lib/catalog");
const { update, id, prune } = require("./lib/orders");
const { lookup } = require("./lib/check");
const { readFields, validate, html } = require("./lib/contract");
const { initPayment, getState, isPaid, notificationValid, configured } = require("./lib/tinkoff");
const { notify } = require("./lib/notify");
const { deliver } = require("./lib/deliver");
const { userFromInitData } = require("./lib/telegram");

const ROOT = path.join(__dirname, "web");
const PORT = Number(process.env.PORT || 8791);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((time) => now - time < 60000);
  if (recent.length >= 8) return true;
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "local";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 100000) {
        reject(Object.assign(new Error("Слишком большой запрос."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(Object.assign(new Error("Некорректный запрос."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, type) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type || (typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8"),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function fail(res, error) {
  const status = error.status || 500;
  send(res, status, { error: error.message || "Не получилось выполнить запрос." });
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function emailOk(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function actor(req) {
  return userFromInitData(String(req.headers["x-telegram-init-data"] || ""));
}

function notifySecretOk(req) {
  const expected = String(process.env.SITE_NOTIFY_SECRET || "");
  const got = String(req.headers["x-notify-secret"] || "");
  if (!expected || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function present(order) {
  if (!order) return null;
  const view = {
    id: order.id,
    service: order.service,
    status: order.status,
    amount: order.amount || 0,
  };
  if (order.status === "pending" && order.paymentUrl) view.paymentUrl = order.paymentUrl;
  if (order.status === "paid" && order.service === "check") view.cards = order.cards || [];
  if (order.status === "paid" && order.service === "dkp") view.contract = true;
  if (order.status === "sent") view.message = "Заявка отправлена. Мы свяжемся с вами.";
  return view;
}

async function rememberPaid(order) {
  const title = {
    check: "Проверка техосмотра оплачена.",
    dkp: "Договор оплачен. Откройте бота — бланк можно распечатать.",
  }[order.service] || "Оплата прошла.";

  const lines = [title, `Заказ ${order.id}`];
  if (order.service === "check") {
    for (const card of order.cards || []) {
      lines.push(
        [
          card.dkNumber ? `Карта ${card.dkNumber}` : "",
          card.mark || card.model ? `${card.mark || ""} ${card.model || ""}`.trim() : "",
          card.licencePlate ? `Госномер ${card.licencePlate}` : "",
          card.validity ? `до ${card.validity}` : "",
        ]
          .filter(Boolean)
          .join(", ")
      );
    }
  }
  if (order.service === "dkp" && order.fields) {
    lines.push(`${order.fields.vehicle_make} ${order.fields.vehicle_model}`.trim(), order.fields.email);
  }
  const text = lines.filter(Boolean).join("\n");
  await deliver(text, "Оплата в боте");
  await notify(order.chatId, text);
}

async function markFromBank(order, result) {
  if (!order || order.status === "paid" || order.settled) return order;
  const status = String(result.Status || "").toUpperCase();
  order.bankStatus = status;
  if (isPaid(result)) {
    order.status = "paid";
    order.paidAt = Date.now();
    order.settled = true;
    if (order.service === "check") order.cards = order.cards || [];
    await rememberPaid(order);
    return order;
  }
  if (["REJECTED", "CANCELED", "DEADLINE_EXPIRED", "REVERSED", "REFUNDED"].includes(status)) {
    order.status = status.toLowerCase();
  }
  return order;
}

async function createPayment(order, itemName) {
  const payment = await initPayment({
    orderId: order.id,
    amountRub: order.amount,
    description: itemName,
    email: order.email,
    itemName,
  });
  order.paymentId = payment.paymentId;
  order.paymentUrl = payment.paymentUrl;
  return order;
}

function leadText(service, fields) {
  const names = { kasko: "КАСКО", osago: "ОСАГО", check: "Проверка техосмотра", dkp: "ДКП" };
  const labels = {
    name: "Имя",
    phone: "Телефон",
    brand: "Марка",
    model: "Модель",
    city: "Город",
    query: "VIN или госномер",
    email: "Email",
    vehicle_make: "Марка ТС",
    vehicle_model: "Модель ТС",
    vehicle_year: "Год",
    vehicle_vin: "VIN",
    vehicle_plate: "Госномер",
    vehicle_price: "Стоимость ТС",
    seller_name: "Продавец",
    seller_passport: "Паспорт продавца",
    seller_address: "Адрес продавца",
    buyer_name: "Покупатель",
    buyer_passport: "Паспорт покупателя",
    buyer_address: "Адрес покупателя",
    contract_date: "Дата договора",
    contract_place: "Место составления",
  };
  const lines = [`Заявка: ${names[service] || service}`];
  for (const [key, label] of Object.entries(labels)) {
    if (fields[key]) lines.push(`${label}: ${fields[key]}`);
  }
  return lines.join("\n");
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/catalog") {
    const data = catalog();
    send(res, 200, {
      ...data,
      payment: configured(),
      checkEnabled: Boolean(String(process.env.AUTO_API_KEY || "").trim()),
      siteUrl: process.env.SITE_URL || "",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tinkoff/notification") {
    send(res, 200, "Endpoint Т-Банка готов. Банк присылает сюда POST с уведомлением об оплате.");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tinkoff/notification") {
    const payload = await readBody(req);
    if (!notificationValid(payload)) {
      send(res, 200, "OK");
      return;
    }
    const orderId = String(payload.OrderId || "");
    await update((data) => {
      const order = data.orders[orderId];
      if (!order) return;
      const status = String(payload.Status || "").toUpperCase();
      const paid = isPaid({ Success: payload.Success, Status: status });
      if (paid && order.status !== "paid") {
        order.status = "paid";
        order.paidAt = Date.now();
        if (!order.settled) {
          order.settled = true;
          order._justPaid = true;
        }
      } else if (["REJECTED", "CANCELED", "DEADLINE_EXPIRED", "REVERSED", "REFUNDED"].includes(status)) {
        order.status = status.toLowerCase();
      }
      order.bankStatus = status;
    });
    const paidOrder = await update((data) => {
      const order = data.orders[orderId];
      if (!order || !order._justPaid) return null;
      delete order._justPaid;
      return { ...order };
    });
    if (paidOrder) await rememberPaid(paidOrder);
    send(res, 200, "OK");
    return;
  }

  const orderMatch = url.pathname.match(/^\/api\/order\/([a-z0-9]+)(\/contract|\/sync)?$/);
  if (orderMatch) {
    const [, orderId, action] = orderMatch;
    if (req.method === "GET" && action === "/contract") {
      const order = await update((data) => data.orders[orderId] || null);
      if (!order || order.status !== "paid" || order.service !== "dkp") {
        send(res, 404, "Договор появится после оплаты.");
        return;
      }
      send(res, 200, html(order.fields), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "POST" && action === "/sync") {
      const order = await update(async (data) => {
        const current = data.orders[orderId];
        if (!current || !current.paymentId || current.status === "paid") return current || null;
        try {
          const state = await getState(current.paymentId);
          await markFromBank(current, state);
        } catch (error) {
          current.syncError = error.message;
        }
        return current;
      });
      if (!order) {
        send(res, 404, { error: "Заказ не найден." });
        return;
      }
      send(res, 200, present(order));
      return;
    }

    if (req.method === "GET" && !action) {
      const order = await update((data) => data.orders[orderId] || null);
      if (!order) {
        send(res, 404, { error: "Заказ не найден." });
        return;
      }
      send(res, 200, present(order));
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/lead") {
    const body = await readBody(req);
    const allowed = ["kasko", "osago", "check", "dkp"];
    const service = allowed.includes(body.service) ? body.service : "kasko";
    const fields = {
      name: clip(body.name, 150),
      phone: clip(body.phone, 20),
      brand: clip(body.brand, 80),
      model: clip(body.model, 80),
      city: clip(body.city, 80),
      query: clip(body.query, 20),
      email: clip(body.email, 120),
      vehicle_make: clip(body.vehicle_make, 80),
      vehicle_model: clip(body.vehicle_model, 80),
      vehicle_year: clip(body.vehicle_year, 4),
      vehicle_vin: clip(body.vehicle_vin, 17),
      vehicle_plate: clip(body.vehicle_plate, 12),
      vehicle_price: clip(body.vehicle_price, 12),
      seller_name: clip(body.seller_name, 150),
      seller_passport: clip(body.seller_passport, 20),
      seller_address: clip(body.seller_address, 250),
      buyer_name: clip(body.buyer_name, 150),
      buyer_passport: clip(body.buyer_passport, 20),
      buyer_address: clip(body.buyer_address, 250),
      contract_date: clip(body.contract_date, 10),
      contract_place: clip(body.contract_place, 150),
    };
    if (fields.phone.length < 6) {
      send(res, 400, { error: "Укажите телефон, чтобы мы могли ответить." });
      return;
    }
    if (service === "check" && fields.query.length < 6) {
      send(res, 400, { error: "Укажите VIN или госномер." });
      return;
    }
    if (service !== "check" && service !== "dkp" && !fields.name) {
      send(res, 400, { error: "Укажите имя и телефон." });
      return;
    }
    if (service === "dkp" && (!fields.vehicle_make || !fields.seller_name || !fields.buyer_name)) {
      send(res, 400, { error: "Укажите марку, продавца и покупателя." });
      return;
    }

    const user = actor(req);
    const order = {
      id: id("ld"),
      service,
      status: "sent",
      amount: 0,
      fields,
      chatId: user?.id || null,
      createdAt: Date.now(),
    };
    await update((data) => {
      prune(data);
      data.orders[order.id] = order;
    });
    const from = user
      ? `Telegram: ${[user.name, user.username ? `@${user.username}` : "", user.id].filter(Boolean).join(" ")}`
      : "";
    const text = [leadText(service, fields), from, "Источник: бот"].filter(Boolean).join("\n");
    await deliver(text, "Заявка в боте");
    await notify(order.chatId, "Заявку приняли. Администратор свяжется с вами.");
    send(res, 200, present(order));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/check") {
    if (tooMany(clientIp(req))) {
      send(res, 429, { error: "Слишком много проверок. Подождите минуту." });
      return;
    }
    const body = await readBody(req);
    try {
      const result = await lookup(body.query);
      if (!result.found) {
        send(res, 200, { found: false, message: "Данные не найдены. Оплата не нужна." });
        return;
      }
      const lookupId = id("lk");
      const price = catalog().checkPrice;
      await update((data) => {
        prune(data);
        data.lookups[lookupId] = {
          cards: result.cards,
          query: result.query,
          createdAt: Date.now(),
        };
      });
      send(res, 200, {
        found: true,
        lookupId,
        price,
        message: `Данные найдены. Откройте результат за ${formatPrice(price)} ₽.`,
      });
    } catch (error) {
      if (error.code === "no_key") {
        send(res, 503, { error: error.message, manual: true });
        return;
      }
      fail(res, error);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pay") {
    send(res, 400, { error: "Оплата в боте отключена. Оставьте заявку — администратор свяжется с вами." });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/site-lead") {
    if (!notifySecretOk(req)) {
      send(res, 403, { error: "Нет доступа." });
      return;
    }
    const body = await readBody(req);
    const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    const lines = [clip(body.subject, 180) || "Заявка с сайта", "Источник: сайт"];
    for (const [label, value] of Object.entries(fields)) {
      const text = clip(value, 500);
      if (text) lines.push(`${clip(label, 80)}: ${text}`);
    }
    await deliver(lines.join("\n"), "Заявка с сайта", { mail: false, vk: false });
    send(res, 200, { ok: true });
    return;
  }

  send(res, 404, { error: "Не найдено." });
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, "Метод не поддерживается.");
        return;
      }

      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      const file = path.normalize(path.join(ROOT, pathname));
      const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
      if (file !== ROOT && !file.startsWith(rootWithSep)) {
        send(res, 403, "Forbidden");
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          send(res, 404, "Страница не найдена");
          return;
        }
        const type = TYPES[path.extname(file)] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
        res.end(data);
      });
    } catch (error) {
      if (!res.headersSent) fail(res, error);
    }
  });

  server.listen(PORT, () => {
    console.log(`Страница: http://127.0.0.1:${PORT}`);
  });
  return server;
}

module.exports = { startServer };
