const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "..", "data", "orders.json");

let chain = Promise.resolve();

function emptyStore() {
  return { orders: {}, lookups: {} };
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!data || typeof data !== "object") return emptyStore();
    data.orders = data.orders || {};
    data.lookups = data.lookups || {};
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

function id(prefix) {
  return `${prefix}${crypto.randomBytes(9).toString("hex")}`;
}

function prune(data) {
  const limit = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, lookup] of Object.entries(data.lookups)) {
    if ((lookup.createdAt || 0) < limit) delete data.lookups[key];
  }
}

module.exports = { update, id, prune, read };
