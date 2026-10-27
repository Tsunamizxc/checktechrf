const fs = require("fs");
const PDFDocument = require("pdfkit");
const { formatPrice } = require("./catalog");

function findFont() {
  const candidates = [
    process.env.PDF_FONT,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || "";
}

function contractPdf(fields) {
  const font = findFont();
  if (!font) {
    const error = new Error("На сервере нет шрифта для PDF.");
    error.status = 500;
    throw error;
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font(font);
    doc.fontSize(16).text("Договор купли-продажи транспортного средства", { align: "center" });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`${fields.contract_place || "—"}          ${fields.contract_date || "—"}`);
    doc.moveDown();
    const title = `${fields.vehicle_make || ""} ${fields.vehicle_model || ""}`.trim();
    const price = `${formatPrice(Number(fields.vehicle_price) || 0)} руб.`;
    doc.text(
      `Продавец, ${fields.seller_name}, паспорт ${fields.seller_passport}, адрес: ${fields.seller_address}, и покупатель, ${fields.buyer_name}, паспорт ${fields.buyer_passport}, адрес: ${fields.buyer_address}, заключили договор о нижеследующем.`,
      { align: "justify" }
    );
    doc.moveDown(0.6);
    doc.text("1. Продавец передаёт, а покупатель принимает транспортное средство:");
    doc.text(`Марка, модель: ${title || "—"}`);
    doc.text(`Год выпуска: ${fields.vehicle_year || "—"}`);
    doc.text(`VIN: ${fields.vehicle_vin || "—"}`);
    doc.text(`Госномер: ${fields.vehicle_plate || "—"}`);
    doc.moveDown(0.6);
    doc.text(`2. Стоимость транспортного средства составляет ${price}. Покупатель оплатил эту сумму полностью.`);
    doc.moveDown(0.6);
    doc.text("3. Продавец подтверждает, что транспортное средство не продано другому лицу, не заложено и не находится под запретом.");
    doc.moveDown(0.6);
    doc.text("4. Право собственности переходит к покупателю с момента подписания договора и передачи транспортного средства.");
    doc.moveDown(0.6);
    doc.text("5. Договор составлен в трёх экземплярах: продавцу, покупателю и для ГИБДД.");
    doc.moveDown(1.4);
    doc.text("Продавец ________________________");
    doc.moveDown(0.8);
    doc.text(fields.seller_name || "");
    doc.moveDown(1.2);
    doc.text("Покупатель ______________________");
    doc.moveDown(0.8);
    doc.text(fields.buyer_name || "");
    doc.end();
  });
}

module.exports = { contractPdf };
