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

  return {
    checkPrice,
    dkpPrice,
    services: [
      {
        id: "kasko",
        title: "КАСКО",
        text: "Заявка на расчёт полиса",
        priceLabel: "заявка",
        pay: false,
      },
      {
        id: "osago",
        title: "ОСАГО",
        text: "Оформление полиса онлайн",
        priceLabel: "заявка",
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
      {
        id: "check",
        title: "Проверка техосмотра",
        text: "По VIN или госномеру. Оплата, только если данные найдены",
        priceLabel: `${formatPrice(checkPrice)} ₽`,
        pay: true,
        amount: checkPrice,
      },
    ],
  };
}

module.exports = { catalog, formatPrice };
