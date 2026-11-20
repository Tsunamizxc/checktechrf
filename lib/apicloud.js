function token() {
  return String(process.env.APICLOUD_TOKEN || "").replace(/\s+/g, "");
}

function configured() {
  return Boolean(token());
}

function normalizePlate(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase()
    .replace(/A/g, "А")
    .replace(/B/g, "В")
    .replace(/E/g, "Е")
    .replace(/K/g, "К")
    .replace(/M/g, "М")
    .replace(/H/g, "Н")
    .replace(/O/g, "О")
    .replace(/P/g, "Р")
    .replace(/C/g, "С")
    .replace(/T/g, "Т")
    .replace(/Y/g, "У")
    .replace(/X/g, "Х");
}

function normalizeVin(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function row(label, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return { label, value: text.slice(0, 240) };
}

async function getJson(path, params) {
  const key = token();
  if (!key) {
    const error = new Error("Проверка сейчас не подключена. Оставьте заявку — оператор проверит вручную.");
    error.status = 503;
    error.code = "no_key";
    throw error;
  }

  const url = new URL(`https://api-cloud.ru/api/${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(name, String(value).trim());
    }
  }
  url.searchParams.set("token", key);

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Token: key },
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    const wrapped = new Error("Сервис проверки сейчас не отвечает. Попробуйте ещё раз через минуту.");
    wrapped.status = 504;
    throw wrapped;
  }

  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") {
    const error = new Error("Сервис проверки вернул некорректный ответ.");
    error.status = 502;
    throw error;
  }

  const code = String(data.error || data.message || "");
  if (code === "498" || code === "TOKEN_NO_MONEY") {
    const error = new Error("Баланс сервиса проверки закончился. Оставьте заявку — проверим вручную.");
    error.status = 503;
    throw error;
  }
  if (code === "602" || code === "TOKEN_NO_ACCESS") {
    const error = new Error("Нет доступа к сервису проверки. Оставьте заявку — проверим вручную.");
    error.status = 503;
    throw error;
  }
  if (code === "TEST_TIME_OFF") {
    const error = new Error("Тестовый доступ к проверке закончился. Оставьте заявку — проверим вручную.");
    error.status = 503;
    throw error;
  }
  if (response.status >= 500) {
    const error = new Error(String(data.message || data.errormsg || "Сервис проверки временно недоступен."));
    error.status = 502;
    throw error;
  }

  return data;
}

async function checkEpts(vin) {
  const value = normalizeVin(vin);
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value) && value.length < 8) {
    const error = new Error("Укажите VIN из 17 символов или номер ЭПТС.");
    error.status = 400;
    throw error;
  }

  const params = { type: "pts" };
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) params.vin = value;
  else params.elpts_number = value;

  const data = await getJson("elpts.php", params);
  if (data.found === false || data.status === 404) {
    return {
      found: false,
      query: value,
      title: "Проверка ЭПТС",
      lines: [row("Результат", "Электронный ПТС не найден")],
      summary: "Электронный ПТС не найден.",
    };
  }

  const rez = data.rez && typeof data.rez === "object" ? data.rez : data;
  const lines = [
    row("Вид паспорта", rez.type),
    row("Статус", rez.statuspts || rez.status),
    row("Утилизационный сбор", rez.displosal_fee || rez.disposal_fee),
    row("Выпуск / таможня", rez.vipusk),
    row("Таможенные ограничения", rez.custenc),
    row("Ограничения", rez.restrictions),
    row("Последнее действие", rez.regAction),
  ].filter(Boolean);

  return {
    found: lines.length > 0 || Boolean(data.found),
    query: value,
    title: "Проверка ЭПТС",
    lines: lines.length ? lines : [row("Результат", "Данные ЭПТС получены")],
    summary: lines.map((item) => `${item.label}: ${item.value}`).join("\n") || "Данные ЭПТС получены.",
  };
}

async function checkRnis(plate) {
  const value = normalizePlate(plate);
  if (value.length < 6) {
    const error = new Error("Укажите госномер, например А123ВС777.");
    error.status = 400;
    throw error;
  }

  const data = await getJson("transportMos.php", { type: "rnis", regNum: value });
  if (!data.vehicleExists) {
    return {
      found: false,
      query: value,
      title: "Проверка РНИС",
      lines: [row("Результат", data.message || "ТС не зарегистрировано в системе РНИС")],
      summary: data.message || "ТС не зарегистрировано в системе РНИС.",
    };
  }

  const lines = [
    row("Госномер", value),
    row("В РНИС", "Зарегистрировано"),
    row("Телематика", data.isOnline ? "Передаётся" : "Не передаётся"),
    row("Последняя отметка", data.lastMark),
  ].filter(Boolean);

  for (const item of Array.isArray(data.bnsoList) ? data.bnsoList.slice(0, 5) : []) {
    lines.push(row("БНСО", [item.bnsoNumber, item.type, item.lastMark].filter(Boolean).join(" · ")));
  }

  return {
    found: true,
    query: value,
    title: "Проверка РНИС",
    lines,
    summary: lines.map((item) => `${item.label}: ${item.value}`).join("\n"),
  };
}

async function checkEptsRnis({ vin, plate }) {
  const blocks = [];
  const query = [];
  if (String(vin || "").trim()) {
    const epts = await checkEpts(vin);
    blocks.push(epts);
    query.push(epts.query);
  }
  if (String(plate || "").trim()) {
    const rnis = await checkRnis(plate);
    blocks.push(rnis);
    query.push(rnis.query);
  }
  if (!blocks.length) {
    const error = new Error("Укажите VIN для ЭПТС или госномер для РНИС.");
    error.status = 400;
    throw error;
  }

  const lines = [];
  for (const block of blocks) {
    lines.push(row(block.title, block.found ? "Найдено" : "Не найдено"));
    lines.push(...block.lines);
  }

  return {
    found: blocks.some((block) => block.found),
    query: query.join(" / "),
    lines,
    summary: blocks.map((block) => `${block.title}\n${block.summary}`).join("\n\n"),
  };
}

async function checkMkad(plate) {
  const value = normalizePlate(plate);
  if (value.length < 6) {
    const error = new Error("Укажите госномер, например А123ВС777.");
    error.status = 400;
    throw error;
  }

  const data = await getJson("transportMos.php", {
    type: "pass",
    regNumber: value,
    onlyActual: "1",
  });

  const list = Array.isArray(data.list) ? data.list : [];
  if (!list.length) {
    return {
      found: false,
      query: value,
      lines: [row("Госномер", value), row("Результат", data.message || "Действующие пропуска не найдены")],
      summary: data.message || "Действующие пропуска не найдены.",
    };
  }

  const lines = [row("Госномер", value), row("Найдено пропусков", String(list.length))];
  for (const item of list.slice(0, 8)) {
    lines.push(
      row(
        item.number || "Пропуск",
        [
          item.allowedzona ? `зона ${item.allowedzona}` : "",
          item.passstatus || "",
          item.tip || "",
          item.typepassvalidityperiod || "",
          item.startdate && item.validitydate ? `${item.startdate} — ${item.validitydate}` : item.validitydate || item.startdate || "",
        ]
          .filter(Boolean)
          .join(" · ")
      )
    );
  }

  return {
    found: true,
    query: value,
    lines,
    summary: lines.map((item) => `${item.label}: ${item.value}`).join("\n"),
  };
}

module.exports = { configured, checkEptsRnis, checkMkad };
