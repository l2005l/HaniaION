const $ = (id) => document.getElementById(id);

const calculateButton = $("calculateButton");
const refreshButton = $("refreshButton");
const retryButton = $("retryButton");
const copyButton = $("copyButton");
const downloadTxtButton = $("downloadTxtButton");
const downloadJsonButton = $("downloadJsonButton");
const downloadCsvButton = $("downloadCsvButton");
const progressPanel = $("progressPanel");
const resultsPanel = $("resultsPanel");
const errorPanel = $("errorPanel");
const emptyPanel = $("emptyPanel");
const errorText = $("errorText");
const progressBar = $("progressBar");
const progressPercent = $("progressPercent");
const progressTitle = $("progressTitle");
const themeToggle = $("themeToggle");
const toast = $("toast");

let latestResult = null;
let progressTimer = null;
let toastTimer = null;

const progressStages = [
  { percent: 12, title: "מתחבר ל־NASA CDDIS" },
  { percent: 38, title: "מוריד את קובץ ה־BRDC העדכני" },
  { percent: 66, title: "מחלץ את מקדמי Klobuchar" },
  { percent: 88, title: "ממיר את הנתונים לפורמט RAAM" },
];

function setPanel(panel) {
  [emptyPanel, progressPanel, errorPanel, resultsPanel].forEach((item) => {
    item.classList.toggle("hidden", item !== panel);
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function updateProgress(stageIndex) {
  const stage = progressStages[Math.min(stageIndex, progressStages.length - 1)];
  progressBar.style.width = `${stage.percent}%`;
  progressPercent.textContent = `${stage.percent}%`;
  progressTitle.textContent = stage.title;

  document.querySelectorAll(".progress-steps li").forEach((item, index) => {
    item.classList.toggle("active", index === stageIndex);
    item.classList.toggle("done", index < stageIndex);
  });
}

function startProgress() {
  let stageIndex = 0;
  updateProgress(stageIndex);
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (stageIndex < progressStages.length - 1) {
      stageIndex += 1;
      updateProgress(stageIndex);
    }
  }, 1250);
}

function stopProgress(success = false) {
  clearInterval(progressTimer);
  if (success) {
    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";
  }
}

function setLoading(loading) {
  calculateButton.disabled = loading;
  refreshButton.disabled = loading;
  retryButton.disabled = loading;
  calculateButton.classList.toggle("loading", loading);
  calculateButton.querySelector(".button-label").textContent = loading ? "מעבד נתונים..." : "הורד, המר והצג";
}

function showError(message) {
  errorText.textContent = message;
  setPanel(errorPanel);
}

function formatUtc(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

function displayResult(data) {
  latestResult = data;
  $("fileName").textContent = data.file_name ?? "—";
  $("sourceDate").textContent = data.source_date ?? "—";
  $("updatedAt").textContent = formatUtc(data.updated_at);
  $("data1").textContent = data.data1 ?? "—";
  $("data2").textContent = data.data2 ?? "—";
  $("data3").textContent = data.data3 ?? "—";
  $("data4").textContent = data.data4 ?? "—";
  $("tls").textContent = data.tls ?? "—";
  $("alpha").textContent = Array.isArray(data.alpha) ? data.alpha.join(", ") : "—";
  $("beta").textContent = Array.isArray(data.beta) ? data.beta.join(", ") : "—";
  $("cacheBadge").textContent = data.cached ? "תוצאה שמורה (Cache)" : "עודכן כעת";
  setPanel(resultsPanel);
}

async function calculate() {
  setLoading(true);
  setPanel(progressPanel);
  startProgress();

  try {
    const response = await fetch("/api/calculate", { method: "POST" });
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(payload.detail || `Server error (${response.status})`);
    }

    stopProgress(true);
    await new Promise((resolve) => setTimeout(resolve, 280));
    displayResult(payload);
  } catch (error) {
    stopProgress(false);
    showError(error instanceof Error ? error.message : "אירעה שגיאה לא ידועה.");
  } finally {
    setLoading(false);
  }
}

function resultText() {
  if (!latestResult) return "";
  return [
    `Data1: ${latestResult.data1}`,
    `Data2: ${latestResult.data2}`,
    `Data3: ${latestResult.data3}`,
    `Data4: ${latestResult.data4}`,
    `tLS: ${latestResult.tls}`,
  ].join("\n");
}

async function copyResults() {
  if (!latestResult) return;
  try {
    await navigator.clipboard.writeText(resultText());
    showToast("התוצאות הועתקו");
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = resultText();
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
    showToast("התוצאות הועתקו");
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(`${filename} נשמר`);
}

function downloadTxt() {
  if (!latestResult) return;
  const content = [
    "HaniaION RAAM DATA",
    `Source file: ${latestResult.file_name}`,
    `Source date: ${latestResult.source_date}`,
    `Updated UTC: ${latestResult.updated_at}`,
    "",
    resultText(),
    "",
    `Alpha: ${latestResult.alpha.join(", ")}`,
    `Beta: ${latestResult.beta.join(", ")}`,
  ].join("\n");
  downloadFile("RAAM.txt", content, "text/plain;charset=utf-8");
}

function downloadJson() {
  if (!latestResult) return;
  downloadFile("haniaion-raam.json", JSON.stringify(latestResult, null, 2), "application/json;charset=utf-8");
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function downloadCsv() {
  if (!latestResult) return;
  const headers = ["file_name", "source_date", "updated_at", "data1", "data2", "data3", "data4", "tls", "alpha", "beta", "cached"];
  const values = [
    latestResult.file_name,
    latestResult.source_date,
    latestResult.updated_at,
    latestResult.data1,
    latestResult.data2,
    latestResult.data3,
    latestResult.data4,
    latestResult.tls,
    latestResult.alpha.join(" | "),
    latestResult.beta.join(" | "),
    latestResult.cached,
  ];
  const csv = `${headers.map(escapeCsv).join(",")}\n${values.map(escapeCsv).join(",")}\n`;
  downloadFile("haniaion-raam.csv", csv, "text/csv;charset=utf-8");
}

async function checkHealth() {
  const dot = $("statusDot");
  const text = $("statusText");
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("offline");
    const payload = await response.json();
    if (payload.status !== "ok") throw new Error("offline");
    dot.className = "status-dot online";
    text.textContent = "Service online";
  } catch {
    dot.className = "status-dot offline";
    text.textContent = "Service unavailable";
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("haniaion-theme", theme);
  const themeColor = theme === "light" ? "#edf5fb" : "#07111f";
  document.querySelector('meta[name="theme-color"]').setAttribute("content", themeColor);
}

function initializeTheme() {
  const stored = localStorage.getItem("haniaion-theme");
  const preferred = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(stored || preferred);
}

calculateButton.addEventListener("click", calculate);
refreshButton.addEventListener("click", calculate);
retryButton.addEventListener("click", calculate);
copyButton.addEventListener("click", copyResults);
downloadTxtButton.addEventListener("click", downloadTxt);
downloadJsonButton.addEventListener("click", downloadJson);
downloadCsvButton.addEventListener("click", downloadCsv);
themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

$("year").textContent = new Date().getFullYear();
initializeTheme();
checkHealth();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
