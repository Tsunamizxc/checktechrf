const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");
const tls = require("tls");

const API_HOST = "securepay.tinkoff.ru";

function bankCas() {
  const list = [...tls.rootCertificates];
  const dir = path.join(__dirname, "..", "certs");
  if (!fs.existsSync(dir)) return list;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".pem")) continue;
    const pem = fs.readFileSync(path.join(dir, name), "utf8");
    try {
      tls.createSecureContext({ ca: [...list, pem] });
      list.push(pem);
    } catch (error) {
      console.log(`Сертификат ${name} не подошёл для проверки Т-Банка.`);
    }
  }
  return list;
}

const CA = bankCas();

function configured() {
  return Boolean(process.env.TINKOFF_TERMINAL_KEY && process.env.TINKOFF_PASSWORD);
}

function token(params) {
  const flat = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "Token" || key === "Receipt" || key === "DATA") continue;
    if (value === null || value === "" || typeof value === "object") continue;
    flat[key] = typeof value === "boolean" ? String(value) : String(value);
  }
  flat.Password = process.env.TINKOFF_PASSWORD;
  const joined = Object.keys(flat)
    .sort()
    .map((key) => flat[key])
    .join("");
  return crypto.createHash("sha256").update(joined).digest("hex");
}

async function request(method, params) {
  if (!configured()) {
    const error = new Error("Оплата не настроена: укажите Terminal Key и пароль Т-Банка в .env.");
    error.status = 503;
    throw error;
  }

  const body = {
    ...params,
    TerminalKey: process.env.TINKOFF_TERMINAL_KEY,
  };
  body.Token = token(body);

  let data;
  try {
    data = await postJson(method, body);
  } catch (error) {
    console.log("Т-Банк:", error.code || "", error.message);
    const wrapped = new Error("Т-Банк не ответил. Попробуйте ещё раз через минуту.");
    wrapped.status = 504;
    throw wrapped;
  }
  if (!data || typeof data !== "object") {
    const error = new Error("Платёжный сервис вернул некорректный ответ.");
    error.status = 502;
    throw error;
  }
  return data;
}

function postJson(method, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: API_HOST,
        path: `/v2/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        ca: CA,
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            resolve(null);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function notificationValid(payload) {
  if (!configured()) return false;
  const received = String(payload.Token || "");
  const expected = token(payload);
  if (!received || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function publicBase() {
  return String(process.env.WEB_APP_URL || "").replace(/\/$/, "");
}

async function initPayment({ orderId, amountRub, description, email, itemName }) {
  const base = publicBase();
  if (!base.startsWith("https://")) {
    const error = new Error("Для оплаты нужен публичный WEB_APP_URL на https.");
    error.status = 503;
    throw error;
  }

  const amount = amountRub * 100;
  const receiptEmail = email || process.env.RECEIPT_EMAIL || "";
  if (!receiptEmail) {
    const error = new Error("Укажите email: он нужен для чека.");
    error.status = 400;
    throw error;
  }

  const taxation = process.env.TINKOFF_TAXATION || "usn_income";
  const tax = process.env.TINKOFF_ITEM_TAX || "none";
  const result = await request("Init", {
    Amount: amount,
    OrderId: orderId,
    Description: description.slice(0, 140),
    NotificationURL: `${base}/api/tinkoff/notification`,
    SuccessURL: `${base}/?order=${encodeURIComponent(orderId)}`,
    FailURL: `${base}/?order=${encodeURIComponent(orderId)}&paid=fail`,
    Language: "ru",
    Receipt: {
      Email: receiptEmail,
      Taxation: taxation,
      Items: [
        {
          Name: itemName.slice(0, 128),
          Price: amount,
          Quantity: 1,
          Amount: amount,
          Tax: tax,
          PaymentMethod: "full_payment",
          PaymentObject: "service",
        },
      ],
    },
  });

  if (!bankSuccess(result.Success) || !result.PaymentURL) {
    const error = new Error(result.Message || result.Details || "Не удалось создать платёж.");
    error.status = 400;
    throw error;
  }

  return {
    paymentUrl: result.PaymentURL,
    paymentId: String(result.PaymentId || ""),
  };
}

async function getState(paymentId) {
  return request("GetState", { PaymentId: paymentId });
}

function bankSuccess(value) {
  if (value === true || value === 1) return true;
  return String(value || "").toLowerCase() === "true";
}

function isPaid(result) {
  const status = String(result.Status || "").toUpperCase();
  return bankSuccess(result.Success) && (status === "CONFIRMED" || status === "AUTHORIZED");
}

module.exports = {
  configured,
  notificationValid,
  initPayment,
  getState,
  isPaid,
};
