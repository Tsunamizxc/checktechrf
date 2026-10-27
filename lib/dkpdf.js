const KEY_HEADER = "X-API-Key";
const BASE = "https://auto-api.ru";

function apiKey() {
  return String(process.env.AUTO_API_KEY || "").replace(/\s+/g, "");
}

async function api(path, options = {}) {
  const key = apiKey();
  if (!key) {
    const error = new Error("Сервис дубликата не подключён.");
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      [KEY_HEADER]: key,
      Accept: "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(options.timeout || 30000),
  });
  const type = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (response.status === 200 && (type.includes("pdf") || buffer.subarray(0, 4).toString() === "%PDF")) {
    return buffer;
  }
  let data = null;
  try {
    data = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    data = null;
  }
  if (!response.ok || !data) {
    const error = new Error(data?.detail || data?.message || "Сервис дубликата вернул ошибку.");
    error.status = response.status || 502;
    throw error;
  }
  return data;
}

async function createDkJob(dkNumber) {
  const data = await api("/api/v1/get_dkpdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dkNumber }),
  });
  const payload = data.data && typeof data.data === "object" ? data.data : data;
  const jobId = Number(payload.job_id || payload.id || 0);
  if (!jobId) {
    const error = new Error(payload.detail || payload.message || "Не удалось поставить PDF в очередь.");
    error.status = 502;
    throw error;
  }
  return jobId;
}

async function readyPdf(jobId) {
  const data = await api(`/api/v1/dkpdf/jobs/${jobId}`);
  const payload = data.data && typeof data.data === "object" ? data.data : data;
  const state = String(payload.status || "");
  if (state === "failed") {
    const error = new Error(payload.last_error || "Не удалось подготовить PDF дубликата.");
    error.status = 502;
    throw error;
  }
  if (state !== "ready") return null;
  const file = await api(`/api/v1/dkpdf/jobs/${jobId}/download`, { timeout: 60000 });
  return Buffer.isBuffer(file) ? file : null;
}

module.exports = { createDkJob, readyPdf };
