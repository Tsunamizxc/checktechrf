function rubles(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return value;
}

function formatPrice(amount) {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function catalog() {
  const checkPrice = rubles("CHECK_PRICE", 30);
  const dkpPrice = rubles("DKP_PRICE", 1000);
  const dkPrice = rubles("DK_PRICE", 800);

  return {
    checkPrice,
    dkpPrice,
    dkPrice,
    services: [
      {
        id: "osago",
        title: "ОСАГО",
        text: "Калькулятор Росстрах и заявка",
        priceLabel: "виджет",
        pay: false,
      },
      {
        id: "kasko",
        title: "КАСКО",
        text: "Заявка на расчёт полиса",
        priceLabel: "заявка",
        pay: false,
      },
      {
        id: "dublikat",
        title: "Дубликат ДК",
        text: "PDF диагностической карты на email",
        priceLabel: `${formatPrice(dkPrice)} ₽`,
        pay: true,
        amount: dkPrice,
      },
      {
        id: "check",
        title: "Проверка техосмотра",
        text: "По VIN или госномеру. Оплата, если данные найдены",
        priceLabel: `${formatPrice(checkPrice)} ₽`,
        pay: true,
        amount: checkPrice,
      },
      {
        id: "tehosmotr",
        title: "Запись на техосмотр",
        text: "Онлайн-запись в пункт и заявка",
        priceLabel: "виджет",
        pay: false,
      },
      {
        id: "dkp",
        title: "ДКП",
        text: "Договор купли-продажи в PDF",
        priceLabel: `${formatPrice(dkpPrice)} ₽`,
        pay: true,
        amount: dkpPrice,
      },
    ],
  };
}

module.exports = { catalog, formatPrice };
