const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.("#f0f6fc");
tg?.setBackgroundColor?.("#f0f6fc");

const app = document.querySelector("#app");
const params = new URLSearchParams(location.search);
const userName = params.get("userName") || tg?.initDataUnsafe?.user?.first_name || "";

const forms = {
  kasko: {
    title: "КАСКО",
    lead: "Оставьте заявку — подготовим расчёт и свяжемся. Полис оплачивается после выбора варианта.",
    submit: "Оставить заявку",
    fields: [
      ["name", "Имя", "text", true],
      ["phone", "Телефон", "tel", true],
      ["brand", "Марка", "text", false],
      ["model", "Модель", "text", false],
      ["city", "Город", "text", false],
    ],
  },
  osago: {
    title: "ОСАГО",
    lead: "Укажите контакты и авто. Сравним предложения и поможем оформить полис.",
    submit: "Оформить ОСАГО",
    fields: [
      ["name", "Имя", "text", true],
      ["phone", "Телефон", "tel", true],
      ["brand", "Марка", "text", false],
      ["model", "Модель", "text", false],
      ["city", "Город", "text", false],
    ],
  },
  check: {
    title: "Проверка техосмотра",
    lead: "Оставьте VIN или госномер и телефон. Заявку получит администратор и свяжется с вами.",
    submit: "Оставить заявку",
    fields: [
      ["name", "Имя", "text", false],
      ["phone", "Телефон", "tel", true],
      ["query", "VIN или госномер", "text", true],
    ],
  },
  dkp: {
    title: "Договор купли-продажи",
    lead: "Заполните данные договора и оставьте телефон. Заявку получит администратор.",
    submit: "Оставить заявку",
    groups: [
      ["Транспорт", [
        ["vehicle_make", "Марка", "text", true],
        ["vehicle_model", "Модель", "text", true],
        ["vehicle_year", "Год выпуска", "text", false],
        ["vehicle_vin", "VIN", "text", true],
        ["vehicle_plate", "Госномер", "text", false],
        ["vehicle_price", "Стоимость, ₽", "text", true],
      ]],
      ["Продавец", [
        ["seller_name", "ФИО", "text", true],
        ["seller_passport", "Паспорт", "text", true],
        ["seller_address", "Адрес", "text", true],
      ]],
      ["Покупатель", [
        ["buyer_name", "ФИО", "text", true],
        ["buyer_passport", "Паспорт", "text", true],
        ["buyer_address", "Адрес", "text", true],
      ]],
      ["Договор", [
        ["phone", "Телефон", "tel", true],
        ["contract_place", "Город составления", "text", true],
        ["contract_date", "Дата", "text", true],
        ["email", "Email", "email", false],
      ]],
    ],
  },
};

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  });
  []
    .concat(children || [])
    .flat()
    .forEach((child) => {
      if (child == null || child === false) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
  return node;
}

function field([name, label, type, required]) {
  const input = el("input", {
    id: name,
    name,
    type: type || "text",
    required: required ? "required" : null,
    autocomplete: name === "email" ? "email" : "off",
  });
  if (name === "phone") input.placeholder = "+7";
  if (name === "contract_date" && !input.value) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    input.value = `${day}.${month}.${now.getFullYear()}`;
  }
  return el("label", {}, [label + (required ? " *" : ""), input]);
}

function formValues(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = String(value).trim();
  });
  return data;
}

async function api(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg?.initData || "",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error("Нет связи с сервером. Попробуйте ещё раз.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Не получилось выполнить запрос.");
    error.manual = data.manual;
    throw error;
  }
  return data;
}

function openPay(url) {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

let catalogCache = null;

function goServices() {
  if (location.search) history.replaceState(null, "", location.pathname);
  if (catalogCache) home(catalogCache);
  else boot(false);
}

function shell(content, withBack) {
  const header = el("header", { class: "top" }, [
    el("div", { class: "mark", text: "ПТ" }),
    el("div", {}, [
      el("strong", { text: "Проверка техосмотра" }),
      el("p", { text: userName ? `${userName}, выберите услугу` : "КАСКО, ОСАГО, ДКП и проверка техосмотра" }),
    ]),
  ]);
  const nodes = [header];
  if (withBack) {
    const back = el("button", { class: "back", type: "button", text: "Все услуги" });
    back.addEventListener("click", goServices);
    nodes.push(back);
  }
  nodes.push(content);
  app.replaceChildren(...nodes);
}

function banner(kind, text) {
  return el("div", { class: `banner ${kind}`, text });
}

function home(catalog) {
  catalogCache = catalog;
  const list = el(
    "div",
    { class: "sheet" },
    catalog.services.map((service) => {
      const button = el("button", { class: "service", type: "button" }, [
        el("strong", { text: service.title }),
        el("small", { text: service.text }),
        el("span", { class: "price", text: service.priceLabel }),
      ]);
      button.addEventListener("click", () => showForm(catalog, service.id));
      return button;
    })
  );
  const wrap = el("div", {}, [list]);
  if (String(catalog.siteUrl || "").startsWith("https://")) {
    const link = el("a", { class: "site", href: catalog.siteUrl, text: "Открыть сайт" });
    link.addEventListener("click", (event) => {
      if (!tg?.openLink) return;
      event.preventDefault();
      tg.openLink(catalog.siteUrl);
    });
    wrap.append(link);
  }
  shell(wrap);
}

function showForm(catalog, serviceId) {
  const spec = forms[serviceId];
  const status = el("div");
  const groups = spec.groups
    ? spec.groups.map(([title, items]) => el("div", { class: "group" }, [el("h2", { text: title }), ...items.map(field)]))
    : spec.fields.map(field);
  const consent = el("input", { type: "checkbox", required: "required" });
  const submit = el("button", { class: "primary", type: "submit", text: spec.submit });
  const form = el("form", {}, [
    ...groups,
    el("label", { class: "consent" }, [consent, "Согласен на обработку данных для заявки."]),
    status,
    submit,
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.replaceChildren();
    submit.disabled = true;
    const data = formValues(form);
    try {
      const lead = await api("/api/lead", {
        service: serviceId,
        ...data,
        name: data.name || data.seller_name || userName,
      });
      showResult(lead);
    } catch (error) {
      if (error.manual) {
        status.append(banner("bad", `${error.message} Укажите телефон и отправьте ещё раз.`));
      } else {
        status.append(banner("bad", error.message));
      }
      submit.disabled = false;
    }
  });

  const lead = spec.lead;
  shell(
    el("section", { class: "sheet panel" }, [el("h1", { text: spec.title }), el("p", { class: "lead", text: lead }), form]),
    true
  );
}

function showPayment(order) {
  if (order.paymentUrl) openPay(order.paymentUrl);
  const status = el("div", {}, [el("p", { class: "note", text: "Откройте страницу Т-Банка и оплатите. После оплаты нажмите кнопку ниже." })]);
  const again = el("button", { class: "ghost", type: "button", text: "Открыть оплату ещё раз" });
  again.addEventListener("click", () => openPay(order.paymentUrl));
  const check = el("button", { class: "primary", type: "button", text: "Я оплатил" });
  check.addEventListener("click", () => refreshOrder(order.id, status, check));
  shell(el("section", { class: "sheet panel" }, [el("h1", { text: "Оплата" }), status, order.paymentUrl ? again : null, check]), true);
}

async function refreshOrder(orderId, status, button) {
  if (button) button.disabled = true;
  try {
    const order = await api(`/api/order/${orderId}/sync`, {});
    if (order.status === "paid" || order.status === "sent") {
      showResult(order);
      return;
    }
    if (status) {
      status.replaceChildren(banner("bad", "Оплата пока не пришла. Если деньги списались, подождите минуту и нажмите ещё раз."));
    }
  } catch (error) {
    if (status) status.replaceChildren(banner("bad", error.message));
  }
  if (button) button.disabled = false;
}

function cardView(card) {
  const lines = [
    card.dkNumber ? `Карта ${card.dkNumber}` : "",
    [card.mark, card.model].filter(Boolean).join(" "),
    card.licencePlate ? `Госномер ${card.licencePlate}` : "",
    card.vin ? `VIN ${card.vin}` : "",
    card.validity ? `Действует до ${card.validity}` : "",
  ].filter(Boolean);
  return el(
    "article",
    {},
    lines.map((line) => el("p", { text: line }))
  );
}

function showResult(order) {
  const blocks = [el("h1", { text: order.status === "paid" ? "Готово" : "Заявка отправлена" })];
  if (order.message) blocks.push(el("p", { class: "lead", text: order.message }));
  if (order.cards?.length) blocks.push(el("div", { class: "card-list" }, order.cards.map(cardView)));
  if (order.contract) {
    blocks.push(el("iframe", { class: "frame", title: "Договор", src: `/api/order/${order.id}/contract` }));
    const print = el("button", { class: "ghost", type: "button", text: "Печать" });
    print.addEventListener("click", () => {
      const frame = app.querySelector("iframe");
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    });
    blocks.push(print);
  }
  const back = el("button", { class: "primary", type: "button", text: "К услугам" });
  back.addEventListener("click", goServices);
  blocks.push(back);
  shell(el("section", { class: "sheet panel" }, blocks), true);
}

async function boot(fromReturn) {
  const catalog = await api("/api/catalog");
  const orderId = fromReturn ? params.get("order") : "";
  if (!orderId) {
    home(catalog);
    return;
  }
  const status = el("div", {}, [el("p", { class: "note", text: params.get("paid") === "fail" ? "Оплата не завершилась. Проверяем заказ." : "Проверяем оплату." })]);
  shell(el("section", { class: "sheet panel" }, [el("h1", { text: "Оплата" }), status]), true);
  await refreshOrder(orderId, status);
}

boot(true).catch((error) => {
  shell(el("section", { class: "sheet panel" }, [banner("bad", error.message)]));
});
