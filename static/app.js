"use strict";

const byId = id => document.getElementById(id);

const elements = {
  calculateButton: byId("calculateButton"),
  heroCalculateButton: byId("heroCalculateButton"),
  refreshButton: byId("refreshButton"),
  retryButton: byId("retryButton"),
  copyButton: byId("copyButton"),
  downloadTxtButton: byId("downloadTxtButton"),
  downloadJsonButton: byId("downloadJsonButton"),
  downloadCsvButton: byId("downloadCsvButton"),
  viewResultsButton: byId("viewResultsButton"),
  resultsPanel: byId("resultsPanel"),
  idleState: byId("idleState"),
  loadingState: byId("loadingState"),
  successState: byId("successState"),
  errorState: byId("errorState"),
  loadingTitle: byId("loadingTitle"),
  loadingDescription: byId("loadingDescription"),
  progressBar: byId("progressBar"),
  progressStep: byId("progressStep"),
  elapsedTime: byId("elapsedTime"),
  errorText: byId("errorText"),
  themeToggle: byId("themeToggle"),
  serviceStatus: byId("serviceStatus"),
  serviceStatusText: byId("serviceStatusText"),
  toast: byId("toast"),
};

let latestResult = null;
let loadingTimer = null;
let elapsedTimer = null;
let loadingStartedAt = 0;
let toastTimer = null;

const loadingSteps = [
  { delay: 0, progress: 12, title: "Connecting to NASA CDDIS", description: "Establishing a secure Earthdata session...", step: "Step 1 of 4" },
  { delay: 1800, progress: 38, title: "Locating the latest BRDC file", description: "Checking the most recent UTC daily directories...", step: "Step 2 of 4" },
  { delay: 4200, progress: 68, title: "Parsing the RINEX header", description: "Extracting GPS Alpha, Beta, and leap-second values...", step: "Step 3 of 4" },
  { delay: 6800, progress: 88, title: "Converting for RAAM", description: "Scaling coefficients and packing the output words...", step: "Step 4 of 4" },
];

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 1800);
}

function setState(name) {
  const states = ["idle", "loading", "success", "error"];
  states.forEach(state => byId(`${state}State`).classList.toggle("hidden", state !== name));
}

function setButtonsDisabled(disabled) {
  [elements.calculateButton, elements.heroCalculateButton].filter(Boolean).forEach(button => button.classList.toggle("loading", disabled));
  [elements.calculateButton, elements.heroCalculateButton, elements.refreshButton, elements.retryButton]
    .filter(Boolean)
    .forEach(button => { button.disabled = disabled; });
}

function startLoadingPresentation() {
  stopLoadingPresentation();
  setState("loading");
  loadingStartedAt = performance.now();
  let index = 0;

  const applyStep = () => {
    const current = loadingSteps[index];
    elements.progressBar.style.width = `${current.progress}%`;
    elements.loadingTitle.textContent = current.title;
    elements.loadingDescription.textContent = current.description;
    elements.progressStep.textContent = current.step;
    index += 1;
    if (index < loadingSteps.length) {
      loadingTimer = setTimeout(applyStep, loadingSteps[index].delay - current.delay);
    }
  };

  applyStep();
  elapsedTimer = setInterval(() => {
    elements.elapsedTime.textContent = `${((performance.now() - loadingStartedAt) / 1000).toFixed(1)}s`;
  }, 100);
}

function stopLoadingPresentation() {
  clearTimeout(loadingTimer);
  clearInterval(elapsedTimer);
  loadingTimer = null;
  elapsedTimer = null;
}

function formatDateTime(isoString) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function formatCoefficient(value) {
  if (typeof value !== "number") return String(value);
  return value.toExponential(12).replace("e", "E");
}

function displayResult(data) {
  latestResult = data;
  byId("fileName").textContent = data.file_name;
  byId("sourceDate").textContent = data.source_date;
  animateValue(byId("data1"), data.data1);
  animateValue(byId("data2"), data.data2);
  animateValue(byId("data3"), data.data3);
  animateValue(byId("data4"), data.data4);
  animateValue(byId("tls"), data.tls, 650);
  byId("alpha").textContent = data.alpha.map(formatCoefficient).join("  ·  ");
  byId("beta").textContent = data.beta.map(formatCoefficient).join("  ·  ");
  byId("cacheBadge").textContent = data.cached ? "Cached result" : "Updated now";
  byId("updatedAt").textContent = formatDateTime(data.updated_at);
  elements.resultsPanel.classList.remove("hidden");
}

async function calculate({ scrollToWorkspace = false } = {}) {
  if (scrollToWorkspace) {
    byId("converter").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  setButtonsDisabled(true);
  startLoadingPresentation();

  try {
    const response = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Accept": "application/json" },
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("The server returned an unreadable response.");
    }

    if (!response.ok) {
      throw new Error(payload.detail || `Request failed with HTTP ${response.status}.`);
    }

    displayResult(payload);
    elements.progressBar.style.width = "100%";
    setState("success");
    showToast(payload.cached ? "Cached RAAM data loaded" : "Latest RAAM data generated");
  } catch (error) {
    elements.errorText.textContent = error instanceof Error ? error.message : "An unexpected error occurred.";
    setState("error");
  } finally {
    stopLoadingPresentation();
    setButtonsDisabled(false);
  }
}

function buildTextExport() {
  if (!latestResult) return "";
  return [
    "HaniaION RAAM Output",
    `Source File: ${latestResult.file_name}`,
    `Source Date: ${latestResult.source_date}`,
    `Updated At: ${latestResult.updated_at}`,
    "",
    `Data1: ${latestResult.data1}`,
    `Data2: ${latestResult.data2}`,
    `Data3: ${latestResult.data3}`,
    `Data4: ${latestResult.data4}`,
    `tLS: ${latestResult.tls}`,
    "",
    `Alpha: ${latestResult.alpha.join(", ")}`,
    `Beta: ${latestResult.beta.join(", ")}`,
  ].join("\n");
}

async function copyText(text, successMessage = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showToast(successMessage);
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTxt() {
  if (!latestResult) return;
  downloadBlob(buildTextExport(), "RAAM.txt", "text/plain;charset=utf-8");
  showToast("RAAM.txt created");
}

function exportJson() {
  if (!latestResult) return;
  downloadBlob(JSON.stringify(latestResult, null, 2), `HaniaION-${latestResult.source_date}.json`, "application/json;charset=utf-8");
  showToast("JSON export created");
}

function exportCsv() {
  if (!latestResult) return;
  const rows = [
    ["file_name", "source_date", "updated_at", "data1", "data2", "data3", "data4", "tls", "alpha", "beta"],
    [latestResult.file_name, latestResult.source_date, latestResult.updated_at, latestResult.data1, latestResult.data2, latestResult.data3, latestResult.data4, latestResult.tls, latestResult.alpha.join(" | "), latestResult.beta.join(" | ")],
  ];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadBlob(csv, `HaniaION-${latestResult.source_date}.csv`, "text/csv;charset=utf-8");
  showToast("CSV export created");
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("haniaion-theme", theme);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#07111f" : "#eef6fb");
  elements.themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
}

function initializeTheme() {
  const saved = localStorage.getItem("haniaion-theme");
  const preferred = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(saved || preferred);
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("offline");
    const payload = await response.json();
    if (payload.status !== "ok") throw new Error("offline");
    elements.serviceStatus.classList.add("online");
    elements.serviceStatus.classList.remove("offline");
    elements.serviceStatusText.textContent = "Service online";
    const apiStatus = byId("apiStatus");
    if (apiStatus) apiStatus.textContent = "Online";
  } catch {
    elements.serviceStatus.classList.add("offline");
    elements.serviceStatus.classList.remove("online");
    elements.serviceStatusText.textContent = "Service unavailable";
    const apiStatus = byId("apiStatus");
    if (apiStatus) apiStatus.textContent = "Unavailable";
  }
}

function registerEvents() {
  elements.calculateButton.addEventListener("click", () => calculate());
  elements.heroCalculateButton.addEventListener("click", () => calculate({ scrollToWorkspace: true }));
  elements.refreshButton.addEventListener("click", () => calculate());
  elements.retryButton.addEventListener("click", () => calculate());
  elements.copyButton.addEventListener("click", () => latestResult && copyText(buildTextExport(), "All RAAM values copied"));
  elements.downloadTxtButton.addEventListener("click", exportTxt);
  elements.downloadJsonButton.addEventListener("click", exportJson);
  elements.downloadCsvButton.addEventListener("click", exportCsv);
  elements.viewResultsButton.addEventListener("click", () => elements.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" }));
  elements.themeToggle.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  document.querySelectorAll(".mini-copy").forEach(button => {
    button.addEventListener("click", () => {
      const target = byId(button.dataset.copyTarget);
      if (target) copyText(target.textContent.trim(), `${button.dataset.copyTarget} copied`);
    });
  });
}


function animateValue(element, value, duration = 900) {
  const target = Number(value);
  if (!element || !Number.isFinite(target)) {
    if (element) element.textContent = value;
    return;
  }
  const started = performance.now();
  const tick = now => {
    const progress = Math.min((now - started) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function initializePremiumMotion() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(element => observer.observe(element));

  const glow = document.querySelector(".cursor-glow");
  if (glow && window.matchMedia("(pointer:fine)").matches) {
    window.addEventListener("pointermove", event => {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    }, { passive: true });
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
  }
}

initializeTheme();
registerEvents();
registerServiceWorker();
initializePremiumMotion();
checkHealth();
setInterval(checkHealth, 60000);
