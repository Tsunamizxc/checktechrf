const fs = require("fs");
const path = require("path");
const { update } = require("./orders");
const { sendMail } = require("./mail");
const { sendDocument } = require("./notify");
const { contractPdf } = require("./pdf");
const { createDkJob, readyPdf } = require("./dkpdf");
const { rememberOperation } = require("./history");
const { checkEpts, checkRnis, checkMkad } = require("./apicloud");
const { notify } = require("./notify");

function savePdf(orderId, pdf) {
  const dir = path.join(__dirname, "..", "data", "pdfs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${orderId}.pdf`), pdf);
}

function rememberReady(order, result) {
  const fields = order.fields || {};
  const query = order.service === "dublikat"
    ? order.dkNumber
    : [fields.vehicle_make, fields.vehicle_model, fields.vehicle_vin].filter(Boolean).join(" ");
  return rememberOperation(
    { id: order.chatId, username: order.username || "" },
    {
      orderId: order.id,
      type: order.service,
      title: order.service === "dublikat" ? "Дубликат ДК" : "Договор купли-продажи",
      query,
      result,
      status: "paid",
      paid: !order.free,
    }
  );
}

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
    await rememberReady(claim, "PDF договора готов и отправлен в чат. Его можно скачать снова.");
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
  try {
    savePdf(order.id, pdf);
  } catch (error) {
    console.log("PDF дубликата:", error.message);
  }
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
      await rememberReady(claimed, "PDF дубликата готов и отправлен в чат. Его можно скачать снова.");
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

async function fulfillApiCheck(order) {
  const claim = await update((data) => {
    const current = data.orders[order.id];
    if (!current || current.status !== "paid" || current.fulfilled || current.checking) return null;
    current.checking = true;
    return { ...current };
  });
  if (!claim) return;

  const titles = {
    epts: "Проверка ЭПТС",
    rnis: "Проверка РНИС",
    mkad: "Пропуск МКАД",
  };
  const ready = {
    epts: "Проверка ЭПТС готова.",
    rnis: "Проверка РНИС готова.",
    mkad: "Пропуск МКАД готов.",
  };

  try {
    let result;
    if (claim.service === "mkad") result = await checkMkad(claim.query || claim.plate);
    else if (claim.service === "rnis") result = await checkRnis(claim.query || claim.plate);
    else result = await checkEpts(claim.vin || claim.query);
    await update((data) => {
      const current = data.orders[order.id];
      if (!current) return;
      current.report = result.lines || [];
      current.summary = result.summary || "";
      current.query = result.query || current.query || "";
      current.fulfilled = true;
      current.checking = false;
      current.fulfillError = "";
    });
    const text = [ready[claim.service] || "Проверка готова.", result.summary || ""].filter(Boolean).join("\n");
    await notify(claim.chatId, text.slice(0, 3500));
    await rememberOperation(
      { id: claim.chatId, username: claim.username || "" },
      {
        orderId: claim.id,
        type: claim.service,
        title: titles[claim.service] || "Проверка",
        query: result.query || claim.query || "",
        result: result.summary || "Результат готов.",
        status: "paid",
        paid: !claim.free,
      }
    );
  } catch (error) {
    console.log("Проверка API:", error.message);
    await update((data) => {
      const current = data.orders[order.id];
      if (!current) return;
      current.checking = false;
      current.fulfillError = error.message;
      current.report = [{ label: "Ошибка", value: error.message }];
      current.summary = error.message;
      current.fulfilled = true;
    });
    await notify(claim.chatId, `Проверка не завершилась: ${error.message}`);
  }
}

function scheduleFulfillment(order) {
  if (!order || order.status !== "paid") return;
  if (order.service === "dkp") sendContract(order).catch((error) => console.log(error.message));
  if (order.service === "dublikat") enqueueDuplicate(order).catch((error) => console.log(error.message));
  if (order.service === "epts" || order.service === "rnis" || order.service === "mkad") {
    fulfillApiCheck(order).catch((error) => console.log(error.message));
  }
}

module.exports = { scheduleFulfillment, pollDuplicates };
