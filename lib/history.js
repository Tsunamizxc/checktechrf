const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pushSiteHistory, deleteSiteHistory } = require("./site-history");

const FILE = path.join(__dirname, "..", "data", "history.json");
const LIMIT = 80;

let chain = Promise.resolve();

function emptyStore() {
  return { users: {} };
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!data || typeof data !== "object") return emptyStore();
    data.users = data.users || {};
    return data;
  } catch (error) {
    return emptyStore();
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}

function update(fn) {
  const run = chain.then(async () => {
    const data = read();
    const result = await fn(data);
    write(data);
    return result;
  });
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function publicCards(cards) {
  return (Array.isArray(cards) ? cards : []).slice(0, 8).map((card) => ({
    dkNumber: clip(card.dkNumber, 32),
    licencePlate: clip(card.licencePlate, 16),
    vin: clip(card.vin, 20),
    mark: clip(card.mark, 40),
    model: clip(card.model, 40),
    validity: clip(card.validity, 20),
  }));
}

async function rememberOperation(user, fields, options = {}) {
  const userId = String(user?.id || "").trim();
  if (!userId || userId === "null") return null;

  const orderId = clip(fields.orderId, 40);
  let item;
  let created = false;
  try {
    item = await update((data) => {
    const bucket = data.users[userId] || { name: "", username: "", items: [] };
    bucket.name = clip(user.name || bucket.name, 80);
    bucket.username = clip(user.username || bucket.username, 64).replace(/^@/, "");
    const items = Array.isArray(bucket.items) ? bucket.items : [];
    const existing = orderId ? items.find((entry) => entry.orderId === orderId) : null;
    const next = existing || {
      id: `h${crypto.randomBytes(8).toString("hex")}`,
      createdAt: fields.createdAt || Date.now(),
    };
    created = !existing;
    next.orderId = orderId;
    next.type = clip(fields.type, 24) || next.type || "lead";
    next.title = clip(fields.title, 120) || next.title || "Операция";
    next.query = clip(fields.query, 180);
    next.result = clip(fields.result, 700);
    next.status = clip(fields.status, 24) || "sent";
    next.paid = Boolean(fields.paid);
    if (Array.isArray(fields.cards) && fields.cards.length) next.cards = publicCards(fields.cards);
    if (!existing) items.unshift(next);
    bucket.items = items.slice(0, LIMIT);
    data.users[userId] = bucket;
    return { ...next, username: bucket.username, name: bucket.name, userId };
    });
  } catch (error) {
    console.log("История:", error.message);
    return null;
  }

  if (created || !options.silent) pushSiteHistory(item);
  return item;
}

async function forgetOperation(userId, entryId, options = {}) {
  const owner = String(userId || "").trim();
  const id = String(entryId || "").trim();
  if (!owner || !id) return null;
  let removed = null;
  try {
    removed = await update((data) => {
      const bucket = data.users[owner];
      if (!bucket || !Array.isArray(bucket.items)) return null;
      const index = bucket.items.findIndex((entry) => entry.id === id);
      if (index < 0) return null;
      const [item] = bucket.items.splice(index, 1);
      return { ...item, userId: owner, username: bucket.username || "", name: bucket.name || "" };
    });
  } catch (error) {
    console.log("История:", error.message);
    return null;
  }
  if (removed && !options.silent) deleteSiteHistory(removed);
  return removed;
}

function listHistory(userId) {
  const bucket = read().users[String(userId)] || { items: [] };
  return (bucket.items || []).map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    query: item.query,
    result: item.result,
    status: item.status,
    paid: item.paid,
    createdAt: item.createdAt,
  }));
}

function findHistory(userId, entryId) {
  const bucket = read().users[String(userId)] || { items: [] };
  return (bucket.items || []).find((item) => item.id === entryId) || null;
}

module.exports = { rememberOperation, forgetOperation, listHistory, findHistory };
