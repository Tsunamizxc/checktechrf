const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { catalog, formatPrice } = require("./lib/catalog");
const { update, id, prune, read } = require("./lib/orders");
const { lookup } = require("./lib/check");
const { readFields, validate, html } = require("./lib/contract");
const { initPayment, getState, isPaid, notificationValid, configured } = require("./lib/tinkoff");
const { notify } = require("./lib/notify");
const { deliver } = require("./lib/deliver");
const { userFromInitData } = require("./lib/telegram");
const { isAdminUser, adminUsernames, adminChatIds } = require("./lib/operator");
const { contractPdf } = require("./lib/pdf");
const { scheduleFulfillment, pollDuplicates } = require("./lib/fulfill");
const { rememberOperation, forgetOperation, listHistory, findHistory, userProfiles, recentEntries, findEntry } = require("./lib/history");
const { confirmLogin, takeLogin } = require("./lib/site-login");

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
  const text = String(value || "").trim().replace(/\s+/g, "");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
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
  if (order.status === "paid" && order.service === "dkp") {
    view.contract = true;
    view.pdf = true;
    view.message = order.free
      ? "PDF договора готов. Его можно скачать, файл также придёт в чат бота."
      : "Оплата прошла. PDF договора можно скачать, он также придёт в чат бота.";
  }
  if (order.status === "paid" && order.service === "dublikat") {
    view.message = order.fulfilled
      ? "PDF дубликата отправлен на email и в чат бота."
      : order.free
        ? "PDF готовится от 5 до 30 минут и придёт в чат бота."
        : "Оплата прошла. PDF готовится от 5 до 30 минут и придёт на email и в чат бота.";
    if (order.fulfilled && fs.existsSync(dkFile(order.id))) view.dkPdf = true;
  }
  if (order.status === "sent") view.message = "Заявка отправлена. Мы свяжемся с вами.";
  return view;
}

async function rememberPaid(order) {
  const title = {
    check: "Проверка техосмотра оплачена.",
    dkp: "Договор оплачен. PDF отправлен клиенту.",
    dublikat: "Дубликат ДК оплачен. PDF готовится и придёт клиенту на email.",
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
    lines.push(`${order.fields.vehicle_make} ${order.fields.vehicle_model}`.trim(), order.fields.email, order.fields.phone);
  }
  if (order.service === "dublikat") {
    lines.push(order.dkNumber ? `ДК ${order.dkNumber}` : "", order.email);
  }
  const text = lines.filter(Boolean).join("\n");
  await deliver(text, "Оплата в боте");
  await notify(order.chatId, text);
  await trackOrder(null, order);
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
  const names = {
    kasko: "КАСКО",
    osago: "ОСАГО",
    check: "Проверка техосмотра",
    dkp: "ДКП",
    dublikat: "Дубликат ДК",
    tehosmotr: "Запись на техосмотр",
  };
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
    dkNumber: "Номер ДК",
    message: "Комментарий",
  };
  const lines = [`Заявка: ${names[service] || service}`];
  for (const [key, label] of Object.entries(labels)) {
    if (fields[key]) lines.push(`${label}: ${fields[key]}`);
  }
  return lines.join("\n");
}

function dkFile(orderId) {
  return path.join(__dirname, "data", "pdfs", `${orderId}.pdf`);
}

function cardSummary(cards) {
  return (cards || [])
    .map((card) =>
      [
        card.dkNumber ? `Карта ${card.dkNumber}` : "",
        [card.mark, card.model].filter(Boolean).join(" "),
        card.licencePlate ? `Госномер ${card.licencePlate}` : "",
        card.vin ? `VIN ${card.vin}` : "",
        card.validity ? `до ${card.validity}` : "",
      ]
        .filter(Boolean)
        .join(", ")
    )
    .filter(Boolean)
    .join("\n");
}

function operationQuery(order) {
  const fields = order.fields || {};
  if (order.service === "site") {
    return fields["Телефон"] || fields["VIN"] || fields["Госномер"] || fields["Город"] || fields["Имя"] || "";
  }
  if (order.service === "check") return order.query || "";
  if (order.service === "dublikat") return order.dkNumber || "";
  if (order.service === "dkp") {
    return [fields.vehicle_make, fields.vehicle_model, fields.vehicle_vin].filter(Boolean).join(" ");
  }
  return fields.query || [fields.brand, fields.model].filter(Boolean).join(" ") || fields.phone || "";
}

function operationResult(order) {
  if (order.service === "site" || order.source === "site") return "Заявка с сайта.";
  if (order.service === "check" && order.status === "paid") {
    return cardSummary(order.cards) || (order.free ? "Результат открыт." : "Результат открыт после оплаты.");
  }
  if (order.service === "dkp" && order.status === "paid") {
    return order.free ? "PDF договора готов. Его можно скачать снова." : "Оплата прошла. PDF договора можно скачать снова.";
  }
  if (order.service === "dublikat" && order.status === "paid") {
    return order.fulfilled ? "PDF дубликата готов и отправлен в чат." : "PDF готовится и придёт в чат.";
  }
  if (order.status === "pending") return "Ожидает оплаты. Результат откроется после неё.";
  if (order.status === "sent") return "Заявка отправлена.";
  return "";
}

const SERVICE_TITLES = {
  check: "Проверка техосмотра",
  dkp: "Договор купли-продажи",
  dublikat: "Дубликат ДК",
  kasko: "КАСКО",
  osago: "ОСАГО",
  tehosmotr: "Запись на техосмотр",
};

async function trackOrder(user, order, options) {
  const userId = user?.id || order?.chatId;
  if (!userId || !order) return;
  try {
    await rememberOperation(
      { id: userId, username: user?.username || order.username || "", name: user?.name || "" },
      {
        orderId: order.id,
        type: order.service,
        title: SERVICE_TITLES[order.service] || "Операция",
        query: operationQuery(order),
        result: operationResult(order),
        status: order.status,
        paid: order.status === "paid" && !order.free,
        cards: order.status === "paid" && order.service === "check" ? order.cards : [],
        createdAt: order.createdAt,
      },
      options
    );
  } catch (error) {
    console.log("История:", error.message);
  }
}

function grantFree(order) {
  order.status = "paid";
  order.amount = 0;
  order.free = true;
  order.paidAt = Date.now();
  order.settled = true;
  return order;
}

function requireAdmin(req, res) {
  const user = actor(req);
  if (!isAdminUser(user)) {
    send(res, 403, { error: "Кабинет администратора доступен только администраторам." });
    return null;
  }
  return user;
}

function personLine(parts) {
  return parts.filter(Boolean).join(" · ");
}

function labeledFields(fields) {
  return Object.entries(fields || {})
    .map(([key, value]) => {
      const text = String(value || "").trim();
      return text ? `${key}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function customerOf(order, profiles) {
  const profile = profiles[String(order.chatId || "")] || {};
  const fields = order.fields || {};
  const username = String(order.username || profile.username || "").replace(/^@/, "");
  const name = profile.name || fields.name || fields["Имя"] || "";
  const phone = fields.phone || fields["Телефон"] || "";
  const email = fields.email || fields["Email"] || order.email || "";
  const customer = personLine([
    name,
    username ? `@${username}` : "",
    !name && !username && phone ? phone : "",
    !name && !username && !phone && order.chatId ? `Telegram ${order.chatId}` : "",
  ]) || (order.service === "site" ? "Заявка с сайта" : "Гость без Telegram");
  const contact = personLine([phone, email && email !== phone ? email : ""]);
  return { customer, contact };
}

function adminPeople(profiles) {
  const rows = new Map();
  const put = (key, person) => {
    const current = rows.get(key);
    if (!current) {
      rows.set(key, person);
      return;
    }
    current.name = current.name || person.name;
    current.username = current.username || person.username;
    current.id = current.id || person.id;
    if (person.via && !current.via.includes(person.via)) current.via = `${current.via}, ${person.via}`;
  };

  for (const username of adminUsernames()) {
    const found = Object.entries(profiles).find(([, profile]) => String(profile.username || "").toLowerCase() === username);
    put(`user:${username}`, {
      username,
      id: found ? found[0] : "",
      name: found ? found[1].name : "",
      via: "назначен в настройках",
    });
  }

  for (const id of adminChatIds()) {
    const profile = profiles[String(id)] || {};
    const username = String(profile.username || "").replace(/^@/, "").toLowerCase();
    const key = username && adminUsernames().includes(username) ? `user:${username}` : `id:${id}`;
    put(key, {
      username: profile.username || "",
      id: String(id),
      name: profile.name || "",
      via: "получает заявки",
    });
  }

  return [...rows.values()];
}

function adminFeed() {
  const profiles = userProfiles();
  const orders = Object.values(read().orders || {});
  for (const order of orders) {
    if (!order.chatId) continue;
    const id = String(order.chatId);
    const profile = profiles[id] || { name: "", username: "" };
    if (order.username && !profile.username) profile.username = String(order.username).replace(/^@/, "");
    profiles[id] = profile;
  }

  const rows = [];
  for (const order of orders) {
    const who = customerOf(order, profiles);
    rows.push({
      kind: "order",
      id: order.id,
      source: order.service === "site" || order.source === "site" ? "site" : "bot",
      title: order.service === "site" ? order.subject || "Заявка с сайта" : SERVICE_TITLES[order.service] || "Заявка",
      status: order.status,
      createdAt: order.createdAt || 0,
      customer: who.customer,
      query: operationQuery(order),
      result: operationResult(order),
    });
  }
  for (const item of recentEntries(80)) {
    const username = String(item.username || "").replace(/^@/, "");
    rows.push({
      kind: "entry",
      id: item.id,
      source: "bot",
      title: item.title || SERVICE_TITLES[item.type] || "Операция",
      status: item.status,
      createdAt: item.createdAt || 0,
      customer: personLine([
        item.name,
        username ? `@${username}` : "",
        !item.name && !username ? `Telegram ${item.userId}` : "",
      ]) || "Гость",
      query: item.query,
      result: item.result,
    });
  }
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { orders: rows.slice(0, 80), admins: adminPeople(profiles) };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/catalog") {
    const data = catalog();
    const admin = isAdminUser(actor(req));
    if (admin) {
      for (const service of data.services) {
        if (service.id === "check" || service.id === "dublikat" || service.id === "dkp") {
          service.priceLabel = "бесплатно";
        }
      }
    }
    send(res, 200, {
      ...data,
      admin,
      payment: configured(),
      checkEnabled: Boolean(String(process.env.AUTO_API_KEY || "").trim()),
      siteUrl: process.env.SITE_URL || "",
      widgets: {
        rosstrahToken: process.env.ROSSTRAH_PARTNER_TOKEN || "KTpwUPyPXT8JcxvfUUbPKIJZC2jdKwtI",
        rosstrahUuid: process.env.ROSSTRAH_UUID || "68ede178-b086-41d0-a899-361f104733ab",
        ekosmotrKey: process.env.EKOSMOTR_KEY || "T2vN9qW5mC1xR8yH4uP7jF3kL6zD0aM",
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/feed") {
    if (!requireAdmin(req, res)) return;
    send(res, 200, adminFeed());
    return;
  }

  const adminOrderMatch = url.pathname.match(/^\/api\/admin\/order\/([a-z0-9]+)$/);
  if (req.method === "GET" && adminOrderMatch) {
    if (!requireAdmin(req, res)) return;
    const order = await update((data) => data.orders[adminOrderMatch[1]] || null);
    if (!order) {
      send(res, 404, { error: "Заявка не найдена." });
      return;
    }
    const view = present(order) || { id: order.id, service: order.service, status: order.status };
    const who = customerOf(order, userProfiles());
    const fromSite = order.service === "site" || order.source === "site";
    view.source = fromSite ? "site" : "bot";
    view.title = fromSite ? order.subject || "Заявка с сайта" : SERVICE_TITLES[order.service] || "Заявка";
    view.customer = who.customer;
    view.contact = who.contact;
    if (!view.cards?.length) view.message = view.message || operationResult(order);
    if (fromSite) view.summary = labeledFields(order.fields);
    else if (order.fields && order.status === "sent") view.summary = leadText(order.service, order.fields);
    send(res, 200, view);
    return;
  }

  const adminEntryMatch = url.pathname.match(/^\/api\/admin\/entry\/([a-z0-9]+)$/);
  if (req.method === "GET" && adminEntryMatch) {
    if (!requireAdmin(req, res)) return;
    const item = findEntry(adminEntryMatch[1]);
    if (!item) {
      send(res, 404, { error: "Операция не найдена." });
      return;
    }
    const username = String(item.username || "").replace(/^@/, "");
    send(res, 200, {
      id: item.id,
      service: item.type,
      status: item.status === "paid" ? "paid" : "sent",
      title: item.title || SERVICE_TITLES[item.type] || "Операция",
      source: "bot",
      customer: personLine([
        item.name,
        username ? `@${username}` : "",
        !item.name && !username ? `Telegram ${item.userId}` : "",
      ]) || "Гость",
      message: item.result,
      cards: item.cards || [],
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
    if (paidOrder) {
      await rememberPaid(paidOrder);
      scheduleFulfillment(paidOrder);
    }
    send(res, 200, "OK");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    const user = actor(req);
    if (!user?.id) {
      send(res, 200, { items: [], guest: true });
      return;
    }
    send(res, 200, { items: listHistory(user.id) });
    return;
  }

  const historyMatch = url.pathname.match(/^\/api\/history\/([a-z0-9]+)$/);
  if (req.method === "GET" && historyMatch) {
    const user = actor(req);
    if (!user?.id) {
      send(res, 401, { error: "Откройте кабинет из Telegram." });
      return;
    }
    const item = findHistory(user.id, historyMatch[1]);
    if (!item) {
      send(res, 404, { error: "Операция не найдена." });
      return;
    }
    if (item.orderId) {
      const order = await update((data) => data.orders[item.orderId] || null);
      if (order && String(order.chatId) === String(user.id)) {
        const view = present(order);
        view.title = item.title;
        view.historyId = item.id;
        if (!view.message) view.message = view.cards?.length ? "Результат проверки." : item.result;
        send(res, 200, view);
        return;
      }
    }
    send(res, 200, {
      id: item.id,
      historyId: item.id,
      service: item.type,
      status: item.status === "paid" ? "paid" : "sent",
      title: item.title,
      message: item.cards?.length && item.status === "paid" ? "Результат проверки." : item.result,
      cards: item.status === "paid" ? item.cards || [] : [],
    });
    return;
  }

  if (req.method === "DELETE" && historyMatch) {
    const user = actor(req);
    if (!user?.id) {
      send(res, 401, { error: "Откройте кабинет из Telegram." });
      return;
    }
    const removed = await forgetOperation(user.id, historyMatch[1]);
    if (!removed) {
      send(res, 404, { error: "Операция не найдена." });
      return;
    }
    send(res, 200, { ok: true });
    return;
  }

  const orderMatch = url.pathname.match(/^\/api\/order\/([a-z0-9]+)(\/contract|\/pdf|\/dk-pdf|\/sync)?$/);
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

    if (req.method === "GET" && action === "/dk-pdf") {
      const order = await update((data) => data.orders[orderId] || null);
      const file = dkFile(orderId);
      if (!order || order.status !== "paid" || order.service !== "dublikat" || !fs.existsSync(file)) {
        send(res, 404, "PDF появится, когда дубликат будет готов.");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dk-${order.id}.pdf"`,
        "Cache-Control": "no-store",
      });
      res.end(fs.readFileSync(file));
      return;
    }

    if (req.method === "GET" && action === "/pdf") {
      const order = await update((data) => data.orders[orderId] || null);
      if (!order || order.status !== "paid" || order.service !== "dkp") {
        send(res, 404, "PDF появится после оплаты.");
        return;
      }
      const pdf = await contractPdf(order.fields);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dogovor-${order.id}.pdf"`,
        "Cache-Control": "no-store",
      });
      res.end(pdf);
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
      if (order.status === "paid") scheduleFulfillment(order);
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
    const allowed = ["kasko", "osago", "check", "dkp", "dublikat", "tehosmotr"];
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
      dkNumber: clip(body.dkNumber, 20),
      message: clip(body.message, 500),
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
      username: clip(user?.username, 64).replace(/^@/, ""),
      createdAt: Date.now(),
    };
    await update((data) => {
      prune(data);
      data.orders[order.id] = order;
    });
    await trackOrder(user, order);
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
    const user = actor(req);
    const admin = isAdminUser(user);
    if (!admin && tooMany(clientIp(req))) {
      send(res, 429, { error: "Слишком много проверок. Подождите минуту." });
      return;
    }
    const body = await readBody(req);
    try {
      const result = await lookup(body.query);
      if (!result.found) {
        await rememberOperation(user, {
          type: "check",
          title: "Проверка техосмотра",
          query: result.query || clip(body.query, 20),
          result: "Данные не найдены. Оплата не нужна.",
          status: "empty",
          paid: false,
        });
        send(res, 200, { found: false, message: "Данные не найдены. Оплата не нужна." });
        return;
      }
      if (admin) {
        await rememberOperation(user, {
          type: "check",
          title: "Проверка техосмотра",
          query: result.query || clip(body.query, 20),
          result: cardSummary(result.cards) || "Данные найдены.",
          status: "paid",
          paid: false,
          cards: result.cards,
        });
        send(res, 200, {
          found: true,
          free: true,
          cards: result.cards,
          message: "Данные найдены. Для администратора результат бесплатный.",
        });
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
    const body = await readBody(req);
    const user = actor(req);
    const prices = catalog();
    try {
      if (body.service === "check") {
        const admin = isAdminUser(user);
        const email = clip(body.email, 120).replace(/\s+/g, "");
        if (!admin && !emailOk(email)) {
          send(res, 400, { error: "Укажите email для чека." });
          return;
        }
        const lookupId = clip(body.lookupId, 40);
        const order = {
          id: id("tg"),
          service: "check",
          status: "pending",
          amount: prices.checkPrice,
          email,
          lookupId,
          cards: [],
          chatId: user?.id || null,
          username: clip(user?.username, 64).replace(/^@/, ""),
          createdAt: Date.now(),
        };
        const saved = await update((data) => {
          const found = data.lookups[lookupId];
          if (!found) return null;
          order.cards = found.cards || [];
          order.query = found.query || "";
          data.orders[order.id] = order;
          return order;
        });
        if (!saved) {
          send(res, 404, { error: "Результат проверки устарел. Проверьте номер ещё раз." });
          return;
        }
        if (admin) grantFree(saved);
        else await createPayment(saved, "Проверка диагностической карты");
        await update((data) => {
          data.orders[saved.id] = saved;
        });
        await trackOrder(user, saved);
        send(res, 200, present(saved));
        return;
      }

      if (body.service === "dkp") {
        const admin = isAdminUser(user);
        const fields = readFields(body);
        validate(fields, { skipEmail: admin });
        const order = {
          id: id("tg"),
          service: "dkp",
          status: "pending",
          amount: prices.dkpPrice,
          email: fields.email,
          fields,
          chatId: user?.id || null,
          username: clip(user?.username, 64).replace(/^@/, ""),
          createdAt: Date.now(),
        };
        if (admin) grantFree(order);
        else await createPayment(order, "Договор купли-продажи ТС");
        await update((data) => {
          prune(data);
          data.orders[order.id] = order;
        });
        await trackOrder(user, order);
        if (admin) scheduleFulfillment(order);
        send(res, 200, present(order));
        return;
      }

      if (body.service === "dublikat") {
        const admin = isAdminUser(user);
        const email = clip(body.email, 120).replace(/\s+/g, "");
        const dkNumber = clip(body.dkNumber, 20).replace(/\s+/g, "");
        if (!admin && !emailOk(email)) {
          send(res, 400, { error: "Укажите email, на который придёт PDF." });
          return;
        }
        if (email && !emailOk(email)) {
          send(res, 400, { error: "Укажите корректный email." });
          return;
        }
        if (admin && !email && !user?.id) {
          send(res, 400, { error: "Укажите email или откройте бота из Telegram, чтобы получить PDF в чат." });
          return;
        }
        if (dkNumber.length < 5) {
          send(res, 400, { error: "Укажите номер диагностической карты." });
          return;
        }
        const order = {
          id: id("tg"),
          service: "dublikat",
          status: "pending",
          amount: prices.dkPrice,
          email,
          dkNumber,
          chatId: user?.id || null,
          username: clip(user?.username, 64).replace(/^@/, ""),
          createdAt: Date.now(),
        };
        if (admin) grantFree(order);
        else await createPayment(order, "Дубликат диагностической карты");
        await update((data) => {
          prune(data);
          data.orders[order.id] = order;
        });
        await trackOrder(user, order);
        if (admin) scheduleFulfillment(order);
        send(res, 200, present(order));
        return;
      }

      send(res, 400, { error: "Эта услуга оформляется заявкой." });
    } catch (error) {
      fail(res, error);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/telegram-login/status") {
    if (!notifySecretOk(req)) {
      send(res, 403, { error: "Нет доступа." });
      return;
    }
    const body = await readBody(req);
    const session = await takeLogin(clip(body.code, 64));
    if (!session) {
      send(res, 200, { ready: false });
      return;
    }
    send(res, 200, { ready: true, ...session });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/history/delete") {
    if (!notifySecretOk(req)) {
      send(res, 403, { error: "Нет доступа." });
      return;
    }
    const body = await readBody(req);
    await forgetOperation(body.telegramId, clip(body.entryId, 80), { silent: true });
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/site-lead") {
    if (!notifySecretOk(req)) {
      send(res, 403, { error: "Нет доступа." });
      return;
    }
    const body = await readBody(req);
    const fields = {};
    const rawFields = body.fields && typeof body.fields === "object" ? body.fields : {};
    for (const [label, value] of Object.entries(rawFields).slice(0, 40)) {
      const key = clip(label, 80);
      const text = clip(value, 500);
      if (key && text) fields[key] = text;
    }
    const subject = clip(body.subject, 180) || "Заявка с сайта";
    const order = {
      id: id("st"),
      service: "site",
      source: "site",
      status: "sent",
      amount: 0,
      subject,
      fields,
      createdAt: Date.now(),
    };
    await update((data) => {
      data.orders[order.id] = order;
    });
    const lines = [subject, "Источник: сайт"];
    for (const [label, value] of Object.entries(fields)) lines.push(`${label}: ${value}`);
    await deliver(lines.join("\n"), "Заявка с сайта", { mail: false, vk: false });
    send(res, 200, { ok: true });
    return;
  }

  send(res, 404, { error: "Не найдено." });
}

async function importHistory() {
  const orders = Object.values(read().orders || {}).filter(
    (order) => order && order.chatId && ["paid", "sent", "pending"].includes(order.status)
  );
  orders.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const order of orders) {
    await trackOrder(null, order, { silent: true });
  }
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
    importHistory().catch((error) => console.log("История:", error.message));
  });
  setInterval(() => {
    pollDuplicates().catch((error) => console.log(error.message));
  }, 60000);
  return server;
}

module.exports = { startServer };
