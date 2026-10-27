const nodemailer = require("nodemailer");
const { domainToASCII } = require("node:url");

function asciiEmail(email) {
  const value = String(email || "").trim();
  const at = value.lastIndexOf("@");
  if (at < 1) return value;
  const domain = domainToASCII(value.slice(at + 1));
  return domain ? `${value.slice(0, at)}@${domain}` : value;
}

function recipients() {
  return String(process.env.NOTIFY_EMAILS || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendMail(subject, text, options = {}) {
  const list = options.to ? [].concat(options.to).filter(Boolean) : recipients();
  const password = process.env.SMTP_PASSWORD || "";
  const user = process.env.SMTP_USER || "";
  if (!list.length || !password || !user) return;

  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.beget.com",
    port,
    secure: port === 465,
    auth: {
      user: asciiEmail(user),
      pass: password,
    },
  });

  const from = asciiEmail(process.env.SMTP_FROM || user);
  await transporter.sendMail({
    from: `"Проверка техосмотра" <${from}>`,
    to: list.map(asciiEmail),
    subject,
    text,
    html: `<h2>${escapeHtml(subject)}</h2><pre style="font:14px/1.45 Segoe UI,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    attachments: options.attachments,
  });
}

module.exports = { sendMail };
