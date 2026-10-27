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
        text: "Заявка на договор купли-продажи",
        priceLabel: "заявка",
        pay: false,
      },
      {
        id: "check",
        title: "Проверка техосмотра",
        text: "Заявка по VIN или госномеру",
        priceLabel: "заявка",
        pay: false,
      },
    ],
  };
}

module.exports = { catalog, formatPrice };
