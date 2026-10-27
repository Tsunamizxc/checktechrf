const { formatPrice } = require("./catalog");

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dash(value) {
  const text = String(value || "").trim();
  return text ? esc(text) : "—";
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function readFields(body) {
  const source = body && typeof body === "object" ? body : {};
  const fields = {
    vehicle_make: clip(source.vehicle_make, 80),
    vehicle_model: clip(source.vehicle_model, 80),
    vehicle_year: clip(source.vehicle_year, 4).replace(/\D/g, ""),
    vehicle_vin: clip(source.vehicle_vin, 17).replace(/\s+/g, "").toUpperCase(),
    vehicle_plate: clip(source.vehicle_plate, 12).toUpperCase(),
    vehicle_price: clip(source.vehicle_price, 9).replace(/\D/g, ""),
    seller_name: clip(source.seller_name, 150),
    seller_passport: clip(source.seller_passport, 20),
    seller_address: clip(source.seller_address, 250),
    buyer_name: clip(source.buyer_name, 150),
    buyer_passport: clip(source.buyer_passport, 20),
    buyer_address: clip(source.buyer_address, 250),
    contract_date: clip(source.contract_date, 10),
    contract_place: clip(source.contract_place, 150),
    email: clip(source.email, 120),
    phone: clip(source.phone, 20),
  };
  return fields;
}

function validate(fields) {
  const required = [
    ["vehicle_make", "Укажите марку"],
    ["vehicle_model", "Укажите модель"],
    ["vehicle_vin", "Укажите VIN"],
    ["vehicle_price", "Укажите стоимость ТС"],
    ["seller_name", "Укажите ФИО продавца"],
    ["seller_passport", "Укажите паспорт продавца"],
    ["seller_address", "Укажите адрес продавца"],
    ["buyer_name", "Укажите ФИО покупателя"],
    ["buyer_passport", "Укажите паспорт покупателя"],
    ["buyer_address", "Укажите адрес покупателя"],
    ["contract_date", "Укажите дату договора"],
    ["contract_place", "Укажите место составления"],
    ["email", "Укажите email для чека"],
  ];
  for (const [name, message] of required) {
    if (!fields[name]) {
      const error = new Error(message);
      error.status = 400;
      throw error;
    }
  }
  if (fields.vehicle_vin.length !== 17) {
    const error = new Error("VIN должен содержать 17 символов.");
    error.status = 400;
    throw error;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    const error = new Error("Укажите корректный email.");
    error.status = 400;
    throw error;
  }
}

function html(fields) {
  const title = `${fields.vehicle_make} ${fields.vehicle_model}`.trim();
  const price = `${formatPrice(Number(fields.vehicle_price) || 0)} руб.`;
  const row = (label, value) => `<p>${label}: ${dash(value)}</p>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Договор купли-продажи</title>
  <style>
    body { margin: 24px; color: #000; background: #fff; font: 15px/1.45 "Times New Roman", Times, serif; }
    h1 { font-size: 18px; text-align: center; margin: 0 0 16px; }
    .place { display: flex; justify-content: space-between; margin-bottom: 16px; }
    p { margin: 0 0 10px; text-align: justify; }
    .signs { display: flex; gap: 24px; margin-top: 28px; }
    .signs div { width: 48%; }
    .line { border-bottom: 1px solid #000; height: 28px; margin: 8px 0; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>Договор купли-продажи транспортного средства</h1>
  <div class="place"><span>${dash(fields.contract_place)}</span><span>${dash(fields.contract_date)}</span></div>
  <p>Продавец, ${dash(fields.seller_name)}, паспорт ${dash(fields.seller_passport)}, адрес: ${dash(fields.seller_address)}, и покупатель, ${dash(fields.buyer_name)}, паспорт ${dash(fields.buyer_passport)}, адрес: ${dash(fields.buyer_address)}, заключили договор о нижеследующем.</p>
  <p><strong>1.</strong> Продавец передаёт, а покупатель принимает транспортное средство:</p>
  ${row("Марка, модель", title)}
  ${row("Год выпуска", fields.vehicle_year)}
  ${row("VIN", fields.vehicle_vin)}
  ${row("Госномер", fields.vehicle_plate)}
  <p><strong>2.</strong> Стоимость транспортного средства составляет ${esc(price)}. Покупатель оплатил эту сумму полностью.</p>
  <p><strong>3.</strong> Продавец подтверждает, что транспортное средство не продано другому лицу, не заложено и не находится под запретом.</p>
  <p><strong>4.</strong> Право собственности переходит к покупателю с момента подписания договора и передачи транспортного средства.</p>
  <p><strong>5.</strong> Договор составлен в трёх экземплярах: продавцу, покупателю и для ГИБДД.</p>
  <div class="signs">
    <div><strong>Продавец</strong><div class="line"></div><p>${dash(fields.seller_name)}</p></div>
    <div><strong>Покупатель</strong><div class="line"></div><p>${dash(fields.buyer_name)}</p></div>
  </div>
</body>
</html>`;
}

module.exports = { readFields, validate, html };
