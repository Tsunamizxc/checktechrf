function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function kindOf(value) {
  const text = normalize(value);
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(text)) return { kind: "vin", value: text };
  const plate = text.replace(/-/g, "");
  if (/^[АВЕКМНОРСТУХABEKMHOPCTYX]\d{3}[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\d{2,3}$/.test(plate)) {
    return { kind: "plate", value: plate };
  }
  return null;
}

function pick(card, keys) {
  for (const key of keys) {
    const value = card[key];
    if (value === undefined || value === null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function looksLikeCard(card) {
  return ["dkNumber", "dkNomer", "nomer", "number", "vin", "licensePlate", "licencePlate", "bodyNumber", "frameNumber"].some(
    (key) => card[key] && typeof card[key] !== "object"
  );
}

function collect(data, out = []) {
  if (!data || typeof data !== "object") return out;
  if (Array.isArray(data)) {
    for (const item of data) collect(item, out);
    return out;
  }

  const nested = [];
  for (const value of Object.values(data)) {
    if (value && typeof value === "object") collect(value, nested);
  }
  if (nested.length) {
    out.push(...nested);
    return out;
  }

  if (looksLikeCard(data)) out.push(publicCard(data));
  return out;
}

function publicCard(card) {
  const record = {
    dkNumber: pick(card, ["dkNumber", "dkNomer", "nomer", "number", "eaistoNumber"]),
    licencePlate: pick(card, ["licencePlate", "licensePlate", "registrationNumber", "regNumber"]),
    vin: pick(card, ["vin"]),
    mark: pick(card, ["mark", "marka", "brand"]),
    model: pick(card, ["model"]),
    validity: pick(card, ["validity", "dkValidity", "validTo", "validUntil", "dateTo"]),
  };
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value));
}

async function lookup(raw) {
  const parsed = kindOf(raw);
  if (!parsed) {
    const error = new Error("Укажите VIN из 17 символов или госномер, например А123ВС777.");
    error.status = 400;
    throw error;
  }

  const key = String(process.env.AUTO_API_KEY || "").replace(/\s+/g, "");
  if (!key) {
    const error = new Error("Проверка сейчас не подключена. Оставьте заявку — оператор проверит вручную.");
    error.status = 503;
    error.code = "no_key";
    throw error;
  }

  const url = new URL("https://auto-api.ru/api/v1/car_inspection");
  url.searchParams.set(parsed.kind === "vin" ? "vin" : "licensePlate", parsed.value);

  let response;
  try {
    response = await fetch(url, {
      headers: { "X-API-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    const wrapped = new Error("База техосмотра сейчас не отвечает. Попробуйте ещё раз через минуту.");
    wrapped.status = 504;
    throw wrapped;
  }

  const data = await response.json().catch(() => null);
  if (response.status === 404) return { found: false, cards: [], query: parsed.value };
  if (!data || typeof data !== "object") {
    const error = new Error("Сервис проверки вернул некорректный ответ. Попробуйте позже.");
    error.status = 502;
    throw error;
  }

  const detail = String(data.detail || data.message || data.error || "");
  if (response.status >= 400 || data.ok === false) {
    if (response.status === 404 || /не найден|not found/i.test(detail)) {
      return { found: false, cards: [], query: parsed.value };
    }
    const error = new Error(detail || "Сервис проверки вернул ошибку. Попробуйте ещё раз.");
    error.status = response.status === 402 ? 503 : 502;
    throw error;
  }

  const cards = collect(data.data ?? data).filter((card) => Object.keys(card).length);
  return { found: cards.length > 0, cards, query: parsed.value };
}

module.exports = { lookup };
