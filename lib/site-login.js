const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "logins.json");
const TTL = 10 * 60 * 1000;

let chain = Promise.resolve();

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!data || typeof data !== "object") return { codes: {} };
    data.codes = data.codes || {};
    return data;
  } catch (error) {
    return { codes: {} };
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
    const now = Date.now();
    for (const [code, row] of Object.entries(data.codes)) {
      if (!row || row.expires < now) delete data.codes[code];
    }
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

function validCode(code) {
  return /^[a-f0-9]{24}$/.test(String(code || ""));
}

function confirmLogin(code, user) {
  if (!validCode(code) || !user?.id) return Promise.resolve(false);
  return update((data) => {
    data.codes[code] = {
      id: Number(user.id),
      username: String(user.username || "").replace(/^@/, "").slice(0, 64),
      name: String(user.name || "").slice(0, 80),
      expires: Date.now() + TTL,
    };
    return true;
  });
}

function takeLogin(code) {
  if (!validCode(code)) return Promise.resolve(null);
  return update((data) => {
    const row = data.codes[code];
    if (!row) return null;
    delete data.codes[code];
    return { id: row.id, username: row.username, name: row.name };
  });
}

module.exports = { confirmLogin, takeLogin, validCode };
