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
  installAppButton: byId("installAppButton"),
  heroInstallButton: byId("heroInstallButton"),
  installModal: byId("installModal"),
  installAndroidInstructions: byId("installAndroidInstructions"),
  installIosInstructions: byId("installIosInstructions"),
  installFallbackInstructions: byId("installFallbackInstructions"),
  confirmInstallButton: byId("confirmInstallButton"),
  historyCount: byId("historyCount"),
  historyEmpty: byId("historyEmpty"),
  historyContent: byId("historyContent"),
  historyList: byId("historyList"),
  clearHistoryButton: byId("clearHistoryButton"),
  comparisonCard: byId("comparisonCard"),
  comparisonTitle: byId("comparisonTitle"),
  comparisonSummary: byId("comparisonSummary"),
  comparisonGrid: byId("comparisonGrid"),
};

let latestResult = null;
let loadingTimer = null;
let elapsedTimer = null;
let loadingStartedAt = 0;
let toastTimer = null;
let deferredInstallPrompt = null;
const HISTORY_STORAGE_KEY = "haniaion-result-history-v1";
const HISTORY_LIMIT = 30;

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
  setLiveStatus("cacheStatusCard", "cacheStatus", "cacheFreshness", "online", data.cached ? "Warm" : "Fresh", data.cached ? "Served from cache" : "Latest source loaded");
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
    saveResultToHistory(payload);
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


function normalizeHistoryEntry(data) {
  return {
    id: `${data.source_date || "unknown"}-${data.updated_at || Date.now()}`,
    saved_at: new Date().toISOString(),
    file_name: data.file_name,
    source_date: data.source_date,
    updated_at: data.updated_at,
    data1: data.data1,
    data2: data.data2,
    data3: data.data3,
    data4: data.data4,
    tls: data.tls,
    alpha: Array.isArray(data.alpha) ? data.alpha : [],
    beta: Array.isArray(data.beta) ? data.beta : [],
    cached: Boolean(data.cached),
  };
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
}

function sameResult(a, b) {
  if (!a || !b) return false;
  return a.file_name === b.file_name && ["data1", "data2", "data3", "data4", "tls"].every(key => Number(a[key]) === Number(b[key]));
}

function saveResultToHistory(data) {
  const history = loadHistory();
  const entry = normalizeHistoryEntry(data);
  if (history.length && sameResult(history[0], entry)) {
    history[0] = { ...history[0], saved_at: entry.saved_at, updated_at: entry.updated_at, cached: entry.cached };
  } else {
    history.unshift(entry);
  }
  saveHistory(history);
  renderHistory();
}

function formatSavedTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function deltaDetails(current, previous, key) {
  const now = Number(current[key]);
  const before = Number(previous[key]);
  const delta = now - before;
  return { now, before, delta, changed: delta !== 0 };
}

function renderComparison(history, selectedIndex = 0) {
  if (!elements.comparisonCard || history.length < 2 || selectedIndex >= history.length - 1) {
    elements.comparisonCard?.classList.add("hidden");
    return;
  }
  const current = history[selectedIndex];
  const previous = history[selectedIndex + 1];
  const keys = ["data1", "data2", "data3", "data4", "tls"];
  const changes = keys.map(key => ({ key, ...deltaDetails(current, previous, key) }));
  const changedCount = changes.filter(item => item.changed).length;
  elements.comparisonCard.classList.remove("hidden");
  elements.comparisonTitle.textContent = `${current.source_date} compared with ${previous.source_date}`;
  elements.comparisonSummary.textContent = changedCount ? `${changedCount} value${changedCount === 1 ? "" : "s"} changed` : "No RAAM value changes";
  elements.comparisonSummary.classList.toggle("no-change", changedCount === 0);
  elements.comparisonGrid.innerHTML = changes.map(item => {
    const sign = item.delta > 0 ? "+" : "";
    const direction = item.delta > 0 ? "up" : item.delta < 0 ? "down" : "same";
    return `<div class="comparison-value ${direction}"><span>${item.key.toUpperCase()}</span><strong>${item.now}</strong><small>${item.changed ? `${sign}${item.delta} from ${item.before}` : `unchanged from ${item.before}`}</small></div>`;
  }).join("");
}

function renderHistory() {
  if (!elements.historyList) return;
  const history = loadHistory();
  elements.historyCount.textContent = `${history.length} saved result${history.length === 1 ? "" : "s"}`;
  elements.historyEmpty.classList.toggle("hidden", history.length > 0);
  elements.historyContent.classList.toggle("hidden", history.length === 0);
  elements.clearHistoryButton.disabled = history.length === 0;
  if (!history.length) {
    elements.historyList.innerHTML = "";
    elements.comparisonCard.classList.add("hidden");
    return;
  }

  elements.historyList.innerHTML = history.map((entry, index) => {
    const previous = history[index + 1];
    const changed = previous ? ["data1", "data2", "data3", "data4", "tls"].filter(key => Number(entry[key]) !== Number(previous[key])).length : null;
    const changeText = previous ? (changed ? `${changed} changed` : "No changes") : "First saved result";
    return `<article class="card history-item" data-history-index="${index}">
      <div class="history-item-main">
        <div class="history-date-block"><span>Source date</span><strong>${entry.source_date || "—"}</strong><small>${formatSavedTime(entry.saved_at)}</small></div>
        <div class="history-values">
          <div><span>D1</span><strong>${entry.data1}</strong></div><div><span>D2</span><strong>${entry.data2}</strong></div><div><span>D3</span><strong>${entry.data3}</strong></div><div><span>D4</span><strong>${entry.data4}</strong></div><div><span>tLS</span><strong>${entry.tls}</strong></div>
        </div>
      </div>
      <div class="history-item-footer">
        <span class="history-change ${changed === 0 ? "no-change" : ""}">${changeText}</span>
        <div class="history-actions">
          ${previous ? `<button type="button" class="text-button history-compare" data-index="${index}">Compare</button>` : ""}
          <button type="button" class="text-button history-open" data-index="${index}">Open</button>
          <button type="button" class="text-button history-download" data-index="${index}">JSON</button>
          <button type="button" class="text-button history-delete" data-index="${index}" aria-label="Delete saved result">Delete</button>
        </div>
      </div>
    </article>`;
  }).join("");

  renderComparison(history, 0);
}

function openHistoryResult(index) {
  const entry = loadHistory()[index];
  if (!entry) return;
  displayResult(entry);
  setState("success");
  elements.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(`Opened result from ${entry.source_date}`);
}

function downloadHistoryResult(index) {
  const entry = loadHistory()[index];
  if (!entry) return;
  downloadBlob(JSON.stringify(entry, null, 2), `HaniaION-${entry.source_date || "history"}.json`, "application/json;charset=utf-8");
  showToast("Saved result exported");
}

function deleteHistoryResult(index) {
  const history = loadHistory();
  if (!history[index]) return;
  history.splice(index, 1);
  saveHistory(history);
  renderHistory();
  showToast("Saved result deleted");
}

function clearHistory() {
  if (!loadHistory().length) return;
  if (!window.confirm("Delete all saved HaniaION results from this device?")) return;
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  renderHistory();
  showToast("History cleared");
}

function registerHistoryEvents() {
  elements.clearHistoryButton?.addEventListener("click", clearHistory);
  elements.historyList?.addEventListener("click", event => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.classList.contains("history-open")) openHistoryResult(index);
    if (button.classList.contains("history-download")) downloadHistoryResult(index);
    if (button.classList.contains("history-delete")) deleteHistoryResult(index);
    if (button.classList.contains("history-compare")) {
      renderComparison(loadHistory(), index);
      elements.comparisonCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
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

function setLiveStatus(cardId, labelId, detailId, state, label, detail) {
  const card = byId(cardId);
  const labelNode = byId(labelId);
  const detailNode = byId(detailId);
  if (card) {
    card.classList.remove("status-checking", "status-online", "status-offline", "status-neutral");
    card.classList.add(`status-${state}`);
  }
  if (labelNode) labelNode.textContent = label;
  if (detailNode) detailNode.textContent = detail;
}

async function checkHealth() {
  const started = performance.now();
  setLiveStatus("apiStatusCard", "apiStatus", "apiLatency", "checking", "Checking", "Health endpoint");
  setLiveStatus("nasaStatusCard", "nasaStatus", "nasaLatency", "checking", "Checking", "Server gateway");
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("offline");
    const payload = await response.json();
    if (payload.status !== "ok") throw new Error("offline");
    const latency = Math.max(1, Math.round(performance.now() - started));
    elements.serviceStatus.classList.add("online");
    elements.serviceStatus.classList.remove("offline");
    elements.serviceStatusText.textContent = "Service online";
    setLiveStatus("apiStatusCard", "apiStatus", "apiLatency", "online", "Online", `${latency} ms response`);
    setLiveStatus("nasaStatusCard", "nasaStatus", "nasaLatency", "online", "Connected", "Earthdata gateway ready");
  } catch {
    elements.serviceStatus.classList.add("offline");
    elements.serviceStatus.classList.remove("online");
    elements.serviceStatusText.textContent = "Service unavailable";
    setLiveStatus("apiStatusCard", "apiStatus", "apiLatency", "offline", "Unavailable", "Health check failed");
    setLiveStatus("nasaStatusCard", "nasaStatus", "nasaLatency", "offline", "Unavailable", "Backend connection required");
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


function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function setInstallButtonsInstalled() {
  [elements.installAppButton, elements.heroInstallButton].filter(Boolean).forEach(button => button.classList.add("is-installed"));
}

function openInstallModal() {
  if (isStandaloneApp()) {
    showToast("HaniaION is already installed");
    setInstallButtonsInstalled();
    return;
  }
  elements.installAndroidInstructions.classList.add("hidden");
  elements.installIosInstructions.classList.add("hidden");
  elements.installFallbackInstructions.classList.add("hidden");

  if (isIosDevice()) {
    elements.installIosInstructions.classList.remove("hidden");
  } else if (deferredInstallPrompt) {
    elements.installAndroidInstructions.classList.remove("hidden");
  } else {
    elements.installFallbackInstructions.classList.remove("hidden");
  }

  elements.installModal.classList.remove("hidden");
  document.body.classList.add("install-modal-open");
}

function closeInstallModal() {
  elements.installModal.classList.add("hidden");
  document.body.classList.remove("install-modal-open");
}

async function confirmInstall() {
  if (!deferredInstallPrompt) {
    closeInstallModal();
    showToast("Use the browser menu to add HaniaION to your home screen");
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  closeInstallModal();
  if (choice.outcome === "accepted") showToast("HaniaION installation started");
}

function initializeInstallExperience() {
  if (isStandaloneApp()) setInstallButtonsInstalled();

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    closeInstallModal();
    setInstallButtonsInstalled();
    showToast("HaniaION installed successfully");
  });

  [elements.installAppButton, elements.heroInstallButton].filter(Boolean).forEach(button => button.addEventListener("click", openInstallModal));
  elements.confirmInstallButton?.addEventListener("click", confirmInstall);
  elements.installModal?.querySelectorAll("[data-close-install]").forEach(node => node.addEventListener("click", closeInstallModal));
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeInstallModal(); });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
  }
}

initializeTheme();
registerEvents();
registerHistoryEvents();
renderHistory();
registerServiceWorker();
initializeInstallExperience();
initializePremiumMotion();
checkHealth();
setInterval(checkHealth, 60000);
