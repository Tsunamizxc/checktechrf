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
    lead: "Калькулятор сравнивает страховые. Если удобнее через менеджера — оставьте заявку.",
    submit: "Оставить заявку",
    fields: [
      ["name", "Имя", "text", true],
      ["phone", "Телефон", "tel", true],
      ["brand", "Марка", "text", false],
      ["model", "Модель", "text", false],
      ["city", "Город", "text", false],
    ],
  },
  tehosmotr: {
    title: "Запись на техосмотр",
    lead: "Выберите пункт в виджете. Если карта не открылась, оставьте заявку — администратор запишет вас.",
    submit: "Оставить заявку",
    fields: [
      ["name", "Имя", "text", true],
      ["phone", "Телефон", "tel", true],
      ["city", "Город", "text", false],
      ["query", "VIN или госномер", "text", false],
    ],
  },
  dublikat: {
    title: "Дубликат ДК",
    lead: "Укажите номер действующей карты и email. После оплаты через Т-Банк PDF готовится 5–30 минут и приходит на почту.",
    submit: "Оставить заявку",
    fields: [
      ["name", "Имя", "text", true],
      ["phone", "Телефон", "tel", true],
      ["email", "Email", "email", false],
      ["dkNumber", "Номер ДК", "text", false],
      ["message", "Комментарий", "textarea", false],
    ],
  },
  check: {
    title: "Проверка техосмотра",
    lead: "Проверьте VIN или госномер. Если записи нет — бесплатно. Если данные найдены, результат открывается после оплаты через Т-Банк.",
    submit: "Оставить заявку",
    fields: [
      ["name", "Имя", "text", false],
      ["phone", "Телефон", "tel", true],
      ["query", "VIN или госномер", "text", true],
    ],
  },
  dkp: {
    title: "Договор купли-продажи",
    lead: "Заполните данные, оплатите через Т-Банк — PDF договора можно скачать и он придёт в чат бота.",
    submit: "Оплатить и получить PDF",
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
        ["email", "Email для чека и PDF", "email", true],
      ]],
    ],
  },
};

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
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
  const input = document.createElement(type === "textarea" ? "textarea" : "input");
  input.name = name;
  input.id = `${name}-${Math.random().toString(36).slice(2, 8)}`;
  if (type === "textarea") input.rows = 3;
  else input.type = type || "text";
  if (required) input.required = true;
  input.autocomplete = name === "email" ? "email" : "off";
  if (name === "email") input.inputMode = "email";
  if (name === "phone") input.placeholder = "+7";
  if (name === "contract_date") {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    input.value = `${day}.${month}.${now.getFullYear()}`;
  }
  return el("label", {}, [label + (required ? " *" : ""), input]);
}

function formValues(form) {
  if (document.activeElement && form.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  const data = {};
  form.querySelectorAll("input, textarea, select").forEach((input) => {
    if (!input.name || input.type === "checkbox" || input.type === "button" || input.type === "submit") return;
    data[input.name] = String(input.value || "").trim();
  });
  return data;
}

async function api(path, body, method) {
  const verb = method || (body ? "POST" : "GET");
  let response;
  try {
    response = await fetch(path, {
      method: verb,
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg?.initData || "",
      },
      body: verb === "POST" ? JSON.stringify(body || {}) : undefined,
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
  if (!url) return;
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

function sitePage(catalog, path) {
  const base = String(catalog.siteUrl || "").replace(/\/$/, "");
  if (!base.startsWith("https://")) return "";
  return `${base}/${String(path || "").replace(/^\//, "")}`;
}

let catalogCache = null;

function goServices() {
  if (location.search) history.replaceState(null, "", location.pathname);
  if (catalogCache) home(catalogCache);
  else boot(false);
}

function shell(content, withBack, wide) {
  document.querySelector("main")?.classList.toggle("wide", Boolean(wide));
  const header = el("header", { class: "top" }, [
    el("div", { class: "mark", text: "ПТ" }),
    el("div", {}, [
      el("strong", { text: "Проверка техосмотра" }),
      el("p", { text: userName ? `${userName}, выберите услугу` : "ОСАГО, КАСКО, дубликат, проверка и договор" }),
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

function formatWhen(ts) {
  const date = new Date(Number(ts) || 0);
  if (!date.getTime()) return "";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL = {
  paid: "Готово",
  pending: "Ожидает оплаты",
  sent: "Заявка отправлена",
  empty: "Данные не найдены",
};

async function showCabinet() {
  const status = el("p", { class: "note", text: "Загружаем историю…" });
  shell(el("section", { class: "sheet panel" }, [el("h1", { text: "Личный кабинет" }), status]), true);
  try {
    const data = await api("/api/history");
    const blocks = [
      el("h1", { text: "Личный кабинет" }),
      el("p", {
        class: "lead",
        text: "Здесь сохраняются проверки, договоры, дубликаты и заявки. Нажмите операцию, чтобы открыть результат.",
      }),
    ];
    if (data.guest) {
      blocks.push(banner("bad", "Откройте кабинет из Telegram, чтобы увидеть свои операции."));
    } else if (!data.items?.length) {
      blocks.push(el("p", { class: "note", text: "Операций пока нет. Они появятся после проверки, договора или заявки." }));
    } else {
      const list = el("div", { class: "sheet" });
      for (const item of data.items) {
        const button = el("button", { class: "service", type: "button" }, [
          el("strong", { text: item.title || "Операция" }),
          el("small", { text: [formatWhen(item.createdAt), STATUS_LABEL[item.status] || "", item.query].filter(Boolean).join(" · ") }),
        ]);
        button.addEventListener("click", () => openHistory(item.id));
        const remove = el("button", { class: "danger", type: "button", text: "Удалить" });
        remove.addEventListener("click", () => removeHistory(item.id, remove));
        list.append(el("div", { class: "history-row" }, [button, remove]));
      }
      blocks.push(list);
    }
    const site = String(catalogCache?.siteUrl || "");
    if (site.startsWith("https://")) {
      const href = `${site.replace(/\/$/, "")}/lichnyy-kabinet/?tab=history`;
      const link = el("a", { class: "site", href, text: "История на сайте" });
      link.addEventListener("click", (event) => {
        if (!tg?.openLink) return;
        event.preventDefault();
        tg.openLink(href);
      });
      blocks.push(link);
    }
    shell(el("section", { class: "sheet panel" }, blocks), true);
  } catch (error) {
    status.replaceChildren(banner("bad", error.message));
  }
}

async function removeHistory(id, button) {
  if (!window.confirm("Удалить эту операцию из истории?")) return;
  if (button) button.disabled = true;
  try {
    await api(`/api/history/${id}`, null, "DELETE");
    await showCabinet();
  } catch (error) {
    if (button) button.disabled = false;
    window.alert(error.message);
  }
}

async function openHistory(id) {
  const status = el("p", { class: "note", text: "Открываем результат…" });
  shell(el("section", { class: "sheet panel" }, [status]), true);
  try {
    const item = await api(`/api/history/${id}`);
    if (item.paymentUrl && item.status === "pending") {
      showPayment(item);
      return;
    }
    showResult(item, true);
  } catch (error) {
    shell(el("section", { class: "sheet panel" }, [banner("bad", error.message)]), true);
  }
}

function home(catalog) {
  catalogCache = catalog;
  const cabinet = el("button", { class: "service", type: "button" }, [
    el("strong", { text: "Личный кабинет" }),
    el("small", { text: "История операций и прошлые результаты" }),
  ]);
  cabinet.addEventListener("click", () => showCabinet());
  const list = el(
    "div",
    { class: "sheet" },
    catalog.services.map((service) => {
      const button = el("button", { class: "service", type: "button" }, [
        el("strong", { text: service.title }),
        el("small", { text: service.text }),
        el("span", { class: "price", text: service.priceLabel }),
      ]);
      button.addEventListener("click", () => showService(catalog, service.id));
      return button;
    })
  );
  const wrap = el("div", { class: "stack" }, [cabinet, list]);
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

function buildForm(serviceId, onSubmit) {
  const spec = forms[serviceId];
  const status = el("div");
  const groups = spec.groups
    ? spec.groups.map(([title, items]) => el("div", { class: "group" }, [el("h2", { text: title }), ...items.map(field)]))
    : spec.fields.map(field);
  const consent = el("input", { type: "checkbox", required: "required" });
  const submit = el("button", { class: "primary", type: "submit", text: spec.submit });
  const form = el("form", {}, [
    ...groups,
    el("label", { class: "consent" }, [consent, "Согласен на обработку данных."]),
    submit,
    status,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.replaceChildren();
    submit.disabled = true;
    try {
      await onSubmit(formValues(form), status, submit);
    } catch (error) {
      status.append(banner("bad", error.message));
      submit.disabled = false;
    }
  });
  return form;
}

async function sendLead(serviceId, data) {
  return api("/api/lead", {
    service: serviceId,
    ...data,
    name: data.name || data.seller_name || userName,
  });
}

function showLead(serviceId) {
  const spec = forms[serviceId];
  const form = buildForm(serviceId, async (data) => {
    showResult(await sendLead(serviceId, data));
  });
  shell(
    el("section", { class: "sheet panel" }, [el("h1", { text: spec.title }), el("p", { class: "lead", text: spec.lead }), form]),
    true
  );
}

function leadFold(serviceId) {
  const details = el("details", { class: "extra" });
  details.append(el("summary", { text: "Или оставить заявку" }));
  details.append(buildForm(serviceId, async (data) => {
    showResult(await sendLead(serviceId, data));
  }));
  return details;
}

function loadWidgetScript(src) {
  document.querySelector(`script[data-widget-src="${src}"]`)?.remove();
  const script = document.createElement("script");
  script.src = `${src}${src.includes("?") ? "&" : "?"}bot=${Date.now()}`;
  script.async = true;
  script.dataset.widgetSrc = src;
  document.head.appendChild(script);
}

function mountWidget(host, options) {
  const node = document.createElement("div");
  node.id = options.id;
  Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, value));
  const pending = el("p", { class: "note", text: "Открываем виджет…" });
  host.replaceChildren(node, pending);
  loadWidgetScript(options.script);
  window.setTimeout(() => {
    if (!node.isConnected) return;
    if (node.querySelector("iframe")) {
      pending.remove();
      return;
    }
    pending.replaceWith(banner("bad", "Виджет не открылся внутри Telegram. Оставьте заявку ниже или откройте услугу на сайте."));
  }, 8000);
}

function showOsago(catalog) {
  const host = el("div", { class: "widget-host" });
  const widgets = catalog.widgets || {};
  const page = sitePage(catalog, "uslugi/osago/");
  const open = page ? el("button", { class: "ghost", type: "button", text: "Открыть ОСАГО на сайте" }) : null;
  open?.addEventListener("click", () => openPay(page));
  shell(
    el("section", { class: "sheet panel" }, [
      el("h1", { text: "ОСАГО" }),
      el("p", { class: "lead", text: forms.osago.lead }),
      host,
      open,
      leadFold("osago"),
    ]),
    true,
    true
  );
  mountWidget(host, {
    id: "rosstrah-osago-widget",
    script: "https://widget.rosstrah.ru/widget-script-osago.js",
    attrs: {
      "data-uuid": widgets.rosstrahUuid || "",
      "data-partner-token": widgets.rosstrahToken || "",
      "data-persist-route": "true",
      "data-is-show-advertisement": "true",
      "data-palette-primary-main": "#1E5EFF",
      "data-theme": "light",
    },
  });
}

function showTehosmotr(catalog) {
  const host = el("div", { class: "widget-host" });
  const page = sitePage(catalog, "uslugi/tehosmotr/");
  const open = page ? el("button", { class: "ghost", type: "button", text: "Открыть запись на сайте" }) : null;
  open?.addEventListener("click", () => openPay(page));
  shell(
    el("section", { class: "sheet panel" }, [
      el("h1", { text: "Запись на техосмотр" }),
      el("p", { class: "lead", text: forms.tehosmotr.lead }),
      host,
      open,
      leadFold("tehosmotr"),
    ]),
    true,
    true
  );
  mountWidget(host, {
    id: "ekosmotr-technical-inspection-widget",
    script: "https://widget.drive-dk.com/widget-script.js",
    attrs: { "data-access-key": catalog.widgets?.ekosmotrKey || "" },
  });
}

function showCheck(catalog) {
  const price = catalog.checkPrice || 30;
  const status = el("div", { class: "stack" });
  const query = field(["query", "VIN или госномер", "text", true]);
  const email = catalog.admin ? null : field(["email", "Email для чека", "email", true]);
  const submit = el("button", { class: "primary", type: "submit", text: "Проверить" });
  const form = el("form", {}, [query, email, submit, status]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.replaceChildren();
    submit.disabled = true;
    const data = formValues(form);
    try {
      const result = await api("/api/check", { query: data.query });
      if (!result.found) {
        status.replaceChildren(banner("ok", result.message));
        submit.disabled = false;
        return;
      }
      if (result.free || catalog.admin) {
        status.replaceChildren(
          banner("ok", result.message || "Для администратора результат бесплатный."),
          result.cards?.length ? el("div", { class: "card-list" }, result.cards.map(cardView)) : null
        );
        submit.disabled = false;
        return;
      }
      if (!catalog.payment) {
        status.replaceChildren(banner("ok", `${result.message} Оплата сейчас недоступна, оставьте заявку ниже.`));
        submit.disabled = false;
        return;
      }
      const pay = el("button", { class: "primary", type: "button", text: `Открыть результат за ${price} ₽` });
      const receipt = form.querySelector('input[name="email"]');
      if (receipt && data.email) receipt.value = data.email;
      const showPay = (errorText) => {
        status.replaceChildren(el("p", { class: "lead", text: result.message }), pay, errorText ? banner("bad", errorText) : null);
      };
      pay.addEventListener("click", async () => {
        const emailValue = String(receipt?.value || data.email || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
          showPay("Укажите email для чека в поле выше.");
          return;
        }
        pay.disabled = true;
        try {
          const order = await api("/api/pay", {
            service: "check",
            lookupId: result.lookupId,
            email: emailValue,
          });
          if (order.status === "paid" && !order.paymentUrl) showResult(order);
          else showPayment(order);
        } catch (error) {
          showPay(error.message);
          pay.disabled = false;
        }
      });
      showPay();
    } catch (error) {
      status.replaceChildren(banner("bad", error.message));
      submit.disabled = false;
    }
  });
  shell(
    el("section", { class: "sheet panel" }, [
      el("h1", { text: "Проверка техосмотра" }),
      el("p", { class: "lead", text: catalog.admin ? "Для администратора проверка бесплатная: результат откроется сразу." : forms.check.lead }),
      catalog.payment || catalog.admin ? null : banner("bad", "Оплата через Т-Банк сейчас не настроена. Можно оставить заявку."),
      form,
      leadFold("check"),
    ]),
    true
  );
}

function showDublikat(catalog) {
  const price = catalog.dkPrice || 800;
  const dk = field(["dkNumber", "Номер ДК", "text", true]);
  const email = field(["email", catalog.admin ? "Email для копии" : "Email для PDF", "email", !catalog.admin]);
  const note = el("div", { class: "stack" });
  const direct = el("form", {}, [
    dk,
    email,
    el("button", { class: "primary", type: "submit", text: catalog.admin ? "Получить PDF" : `Оплатить ${price} ₽ и получить PDF` }),
    note,
  ]);
  direct.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!catalog.admin && !catalog.payment) {
      note.replaceChildren(banner("bad", "Оплата через Т-Банк сейчас не настроена."));
      return;
    }
    const data = formValues(direct);
    const submit = direct.querySelector("button");
    note.replaceChildren();
    submit.disabled = true;
    try {
      const order = await api("/api/pay", { service: "dublikat", dkNumber: data.dkNumber, email: data.email });
      if (order.paymentUrl) showPayment(order);
      else showResult(order);
    } catch (error) {
      note.replaceChildren(banner("bad", error.message));
      submit.disabled = false;
    }
  });
  shell(
    el("section", { class: "sheet panel" }, [
      el("h1", { text: "Дубликат ДК" }),
      el("p", {
        class: "lead",
        text: catalog.admin ? "Для администратора дубликат готовится без оплаты и приходит в чат бота." : forms.dublikat.lead,
      }),
      direct,
      leadFold("dublikat"),
    ]),
    true
  );
}

function showDkp(catalog) {
  if (catalog.admin) {
    forms.dkp.submit = "Сформировать PDF";
    forms.dkp.lead = "Для администратора договор формируется без оплаты.";
    for (const [, items] of forms.dkp.groups) {
      for (const item of items) {
        if (item[0] === "email") {
          item[1] = "Email для копии";
          item[3] = false;
        }
      }
    }
  }
  const form = buildForm("dkp", async (data) => {
    if (!catalog.admin && !catalog.payment) {
      showResult(await sendLead("dkp", data));
      return;
    }
    const order = await api("/api/pay", { service: "dkp", ...data, name: data.seller_name || userName });
    if (order.paymentUrl) showPayment(order);
    else showResult(order);
  });
  shell(
    el("section", { class: "sheet panel" }, [
      el("h1", { text: forms.dkp.title }),
      el("p", { class: "lead", text: forms.dkp.lead }),
      catalog.admin || catalog.payment ? null : banner("bad", "Оплата не настроена: заявка уйдёт администратору без PDF."),
      form,
    ]),
    true
  );
}

function showService(catalog, serviceId) {
  if (serviceId === "osago") return showOsago(catalog);
  if (serviceId === "tehosmotr") return showTehosmotr(catalog);
  if (serviceId === "check") return showCheck(catalog);
  if (serviceId === "dublikat") return showDublikat(catalog);
  if (serviceId === "dkp") return showDkp(catalog);
  return showLead(serviceId);
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
  return el("article", {}, lines.map((line) => el("p", { text: line })));
}

function showResult(order, fromCabinet) {
  const blocks = [el("h1", { text: order.title || (order.status === "paid" ? "Готово" : "Заявка отправлена") })];
  if (order.message) blocks.push(el("p", { class: "lead", text: order.message }));
  if (order.cards?.length) blocks.push(el("div", { class: "card-list" }, order.cards.map(cardView)));
  if (order.contract) {
    blocks.push(el("iframe", { class: "frame", title: "Договор", src: `/api/order/${order.id}/contract` }));
  }
  if (order.pdf) {
    blocks.push(el("a", { class: "primary", href: `/api/order/${order.id}/pdf`, text: "Скачать PDF" }));
  }
  if (order.dkPdf) {
    blocks.push(el("a", { class: "primary", href: `/api/order/${order.id}/dk-pdf`, text: "Скачать дубликат PDF" }));
  }
  if (fromCabinet && order.historyId) {
    const remove = el("button", { class: "ghost", type: "button", text: "Удалить из истории" });
    remove.addEventListener("click", () => removeHistory(order.historyId, remove));
    blocks.push(remove);
  }
  const back = el("button", { class: "primary", type: "button", text: fromCabinet ? "В кабинет" : "К услугам" });
  back.addEventListener("click", () => (fromCabinet ? showCabinet() : goServices()));
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
