const { update } = require("./orders");
const { sendMail } = require("./mail");
const { sendDocument } = require("./notify");
const { contractPdf } = require("./pdf");
const { createDkJob, readyPdf } = require("./dkpdf");

function attachment(filename, content) {
  return [{ filename, content, contentType: "application/pdf" }];
}

async function sendContract(order) {
  const claim = await update((data) => {
    const current = data.orders[order.id];
    if (!current || current.status !== "paid" || current.pdfSent || current.pdfSending) return null;
    current.pdfSending = true;
    return { ...current, fields: current.fields };
  });
  if (!claim) return;

  try {
    const pdf = await contractPdf(claim.fields);
    const filename = `dogovor-${claim.id}.pdf`;
    await sendDocument(claim.chatId, pdf, filename, "Договор купли-продажи. Файл можно скачать и распечатать.");
    if (claim.fields?.email) {
      await sendMail("Договор купли-продажи", "PDF договора во вложении.", {
        to: claim.fields.email,
        attachments: attachment(filename, pdf),
      });
    }
    await update((data) => {
      const current = data.orders[order.id];
      if (!current) return;
      current.pdfSent = true;
      current.pdfSending = false;
    });
  } catch (error) {
    console.log("PDF договора:", error.message);
    await update((data) => {
      const current = data.orders[order.id];
      if (!current) return;
      current.pdfSending = false;
      current.fulfillError = error.message;
    });
  }
}

async function enqueueDuplicate(order) {
  const claim = await update((data) => {
    const current = data.orders[order.id];
    if (!current || current.status !== "paid" || current.jobId || current.jobSending) return null;
    current.jobSending = true;
    return { ...current };
  });
  if (!claim || !claim.dkNumber) return;

  try {
    const jobId = await createDkJob(claim.dkNumber);
    await update((data) => {
      const current = data.orders[order.id];
      if (!current) return;
      current.jobId = jobId;
      current.jobSending = false;
    });
  } catch (error) {
    console.log("Очередь дубликата:", error.message);
    await update((data) => {
      const current = data.orders[order.id];
      if (!current) return;
      current.jobSending = false;
      current.fulfillError = error.message;
    });
  }
}

async function deliverDuplicate(order, pdf) {
  const filename = `dk-${String(order.dkNumber || "card").replace(/\W+/g, "")}.pdf`;
  const text = `Дубликат диагностической карты ${order.dkNumber}. PDF во вложении.`;
  if (order.email) {
    await sendMail("Дубликат диагностической карты", text, {
      to: order.email,
      attachments: attachment(filename, pdf),
    });
  }
  await sendMail(`Дубликат ДК ${order.dkNumber}`, `${text}\nEmail клиента: ${order.email || "—"}\nЗаказ: ${order.id}`, {
    attachments: attachment(filename, pdf),
  });
  await sendDocument(order.chatId, pdf, filename, "Дубликат диагностической карты.");
}

async function pollDuplicates() {
  const pending = await update((data) =>
    Object.values(data.orders).filter(
      (order) => order.service === "dublikat" && order.status === "paid" && order.jobId && !order.fulfilled && !order.pdfSending
    )
  );
  for (const order of pending.slice(0, 3)) {
    try {
      const pdf = await readyPdf(order.jobId);
      if (!pdf) continue;
      const claimed = await update((data) => {
        const current = data.orders[order.id];
        if (!current || current.fulfilled || current.pdfSending) return null;
        current.pdfSending = true;
        return { ...current };
      });
      if (!claimed) continue;
      await deliverDuplicate(claimed, pdf);
      await update((data) => {
        const current = data.orders[order.id];
        if (!current) return;
        current.fulfilled = true;
        current.pdfSending = false;
        current.fulfillError = "";
      });
    } catch (error) {
      console.log("Дубликат:", error.message);
      await update((data) => {
        const current = data.orders[order.id];
        if (!current) return;
        current.pdfSending = false;
        current.fulfillError = error.message;
        if (/не удалось подготовить/i.test(error.message)) current.fulfilled = true;
      });
    }
  }
}

function scheduleFulfillment(order) {
  if (!order || order.status !== "paid") return;
  if (order.service === "dkp") sendContract(order).catch((error) => console.log(error.message));
  if (order.service === "dublikat") enqueueDuplicate(order).catch((error) => console.log(error.message));
}

module.exports = { scheduleFulfillment, pollDuplicates };
