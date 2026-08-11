"use strict";

const byId = id => document.getElementById(id);

function scrollToTarget(id, block = "start", offset = 0) {
  const target = byId(id);
  if (!target) return;
  if (block === "start" && offset) {
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block });
}


const elements = {
  calculateButton: byId("calculateButton"),
  heroCalculateButton: byId("heroCalculateButton"),
  refreshButton: byId("refreshButton"),
  retryButton: byId("retryButton"),
  copyButton: byId("copyButton"),
  downloadTxtButton: byId("downloadTxtButton"),
  downloadJsonButton: byId("downloadJsonButton"),
  downloadCsvButton: byId("downloadCsvButton"),
  shareResultButton: byId("shareResultButton"),
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
  historyShowcaseEmpty: byId("historyShowcaseEmpty"),
  historyShowcaseContent: byId("historyShowcaseContent"),
  showcaseLatestDate: byId("showcaseLatestDate"),
  showcaseChangeStatus: byId("showcaseChangeStatus"),
  historyShowcaseValues: byId("historyShowcaseValues"),
  showcaseSavedTime: byId("showcaseSavedTime"),
  clearHistoryButton: byId("clearHistoryButton"),
  comparisonCard: byId("comparisonCard"),
  comparisonTitle: byId("comparisonTitle"),
  comparisonSummary: byId("comparisonSummary"),
  comparisonGrid: byId("comparisonGrid"),
  notificationButton: byId("notificationButton"),
  notificationStatus: byId("notificationStatus"),
  notificationDescription: byId("notificationDescription"),
  monitorStatus: byId("monitorStatus"),
  monitorBadge: byId("monitorBadge"),
  latestMonitorFile: byId("latestMonitorFile"),
  lastMonitorCheck: byId("lastMonitorCheck"),
  nextMonitorCheck: byId("nextMonitorCheck"),
  lastMonitorChange: byId("lastMonitorChange"),
  utcClock: byId("utcClock"),
  historyChart: byId("historyChart"),
  chartEmpty: byId("chartEmpty"),
  chartMetric: byId("chartMetric"),
  chartRange: byId("chartRange"),
  analyticsCount: byId("analyticsCount"),
  analyticsChanges: byId("analyticsChanges"),
  analyticsCommonHour: byId("analyticsCommonHour"),
  analyticsStableRun: byId("analyticsStableRun"),
  chartInsight: byId("chartInsight"),
  chartMinimum: byId("chartMinimum"),
  chartMaximum: byId("chartMaximum"),
  chartDelta: byId("chartDelta"),
  exportHistoryCsvButton: byId("exportHistoryCsvButton"),
  cloudHistoryStatus: byId("cloudHistoryStatus"),
  syncHistoryButton: byId("syncHistoryButton"),
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
  { delay: 0, progress: 14, title: "מתחבר ל־NASA CDDIS", description: "יוצר חיבור מאובטח למקור Earthdata.", step: "שלב 1 מתוך 4" },
  { delay: 1400, progress: 38, title: "מאתר ומוריד BRDC", description: "בודק את תיקיות ה־UTC האחרונות ומאתר קובץ תקין.", step: "שלב 2 מתוך 4" },
  { delay: 3600, progress: 70, title: "מחשב DATA1–DATA4", description: "מחלץ מקדמי Klobuchar וממיר אותם לערכי RAAM.", step: "שלב 3 מתוך 4" },
  { delay: 6100, progress: 90, title: "מסיים ושומר היסטוריה", description: "מציג את התוצאה ושומר אותה מקומית ובענן, כאשר הוא מוגדר.", step: "שלב 4 מתוך 4" },
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
    document.querySelectorAll(".download-steps li").forEach((item, itemIndex) => {
      item.classList.toggle("active", itemIndex === index);
      item.classList.toggle("done", itemIndex < index);
    });
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
  byId("cacheBadge").textContent = data.stale
    ? "נתונים אחרונים שמורים"
    : (data.cached ? `נתון שמור מהשרת · ${formatDateTime(data.updated_at)}` : "עודכן עכשיו");
  setLiveStatus("cacheStatusCard", "cacheStatus", "cacheFreshness", data.stale ? "warning" : "online", data.stale ? "Stale" : (data.cached ? "Warm" : "Fresh"), data.stale ? "מקור NASA אינו זמין — מוצגים הנתונים האחרונים" : (data.cached ? "Served from cache" : "Latest source loaded"));
  if (window.HaniaDataStatus) {
    if (data.stale) HaniaDataStatus.report("raam", {title:"נתוני DATA1–DATA4 / RAAM אינם מעודכנים", message:data.stale_reason || "מקור NASA CDDIS אינו זמין כרגע. מוצגים הנתונים האחרונים שנשמרו.", lastUpdated:data.updated_at, severity:"error"});
    else HaniaDataStatus.clear("raam");
    // Database/history failures are secondary and must not look like a NASA data failure.
    HaniaDataStatus.clear("database");
    const historyWarning = byId("historyCloudWarning");
    if (historyWarning) {
      const databaseReason = data.database?.reason || "";
      const saveFailed = data.database?.saved === false && databaseReason === "database_error";
      const databaseDisabled = data.database?.saved === false && databaseReason === "database_disabled";
      historyWarning.classList.toggle("hidden", !(saveFailed || databaseDisabled));
      historyWarning.innerHTML = saveFailed
        ? `<strong>⚠️ לא ניתן לשמור כרגע בהיסטוריה בענן</strong><span>נתוני NASA והחישוב תקינים. התוצאה נשמרה במכשיר בלבד.</span>`
        : databaseDisabled
          ? `<strong>היסטוריה בענן אינה מוגדרת</strong><span>התוצאה נשמרה במכשיר הזה. יש להגדיר DATABASE_URL ב-Render כדי לסנכרן בין מכשירים.</span>`
          : "";
    }
  }
  byId("updatedAt").textContent = formatDateTime(data.updated_at);
  const sourceMode = byId("sourceMode");
  const sourceDetail = byId("resultSourceDetail");
  if (sourceMode) sourceMode.textContent = data.stale ? "נתונים אחרונים שמורים" : (data.cached ? "מטמון שרת תקין" : "שליפה חיה");
  if (sourceDetail) sourceDetail.textContent = data.stale
    ? `מקור NASA אינו זמין כרגע. מוצגים הנתונים האחרונים מ־${formatDateTime(data.updated_at)}.`
    : data.cached
      ? `התוצאה התקינה הוגשה ממטמון השרת. עודכנה ב־${formatDateTime(data.updated_at)}.`
      : `הנתונים נשלפו מ־NASA CDDIS ועודכנו ב־${formatDateTime(data.updated_at)}.`;
  elements.resultsPanel.classList.remove("hidden");
}

async function fetchCalculationWithRetry(maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const retryStatus = byId("retryStatus");
    if (retryStatus) {
      retryStatus.classList.toggle("hidden", attempt === 1);
      retryStatus.textContent = attempt === 1 ? "" : `ניסיון התחברות ${attempt} מתוך ${maxAttempts}...`;
    }
    try {
      const response = await fetch("/api/calculate", {method: "POST", headers: {"Accept": "application/json"}});
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error("השרת החזיר תשובה שאינה ניתנת לקריאה."); }
      if (!response.ok) throw new Error(payload.detail || `הבקשה נכשלה: HTTP ${response.status}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 900 * attempt));
    }
  }
  throw lastError || new Error("לא ניתן להשלים את השליפה.");
}

async function calculate({ scrollToWorkspace = false } = {}) {
  if (scrollToWorkspace) byId("converter").scrollIntoView({ behavior: "smooth", block: "start" });
  setButtonsDisabled(true);
  startLoadingPresentation();
  const retryStatus = byId("retryStatus");
  if (retryStatus) { retryStatus.textContent = ""; retryStatus.classList.add("hidden"); }

  try {
    const payload = await fetchCalculationWithRetry(3);
    displayResult(payload);
    saveResultToHistory(payload);
    elements.progressBar.style.width = "100%";
    document.querySelectorAll(".download-steps li").forEach(item => { item.classList.remove("active"); item.classList.add("done"); });
    const databaseReason = payload.database?.reason || "";
    const historyText = payload.database?.saved === true
      ? "נשמרה תוצאה חדשה בהיסטוריה"
      : databaseReason === "duplicate"
        ? "התוצאה כבר קיימת בהיסטוריה"
        : databaseReason === "database_disabled"
          ? "נשמרה במכשיר; היסטוריה בענן עדיין לא הוגדרה"
          : databaseReason === "database_error"
            ? "הנתונים תקינים; שמירת הענן לא הושלמה"
            : "הנתונים מוכנים";
    elements.loadingDescription.textContent = historyText;
    setState("success");
    showToast(payload.cached ? "נתוני RAAM נטענו ממטמון שרת תקין" : "נתוני NASA עודכנו בהצלחה");
    setTimeout(() => scrollToTarget("raam-values-target", "start", 132), 320);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "אירעה שגיאה לא צפויה.";
    const previous = loadHistory()[0];
    if (previous) {
      const stale = {...previous, stale:true, cached:true, stale_reason:"מקור NASA CDDIS אינו זמין כרגע. מוצגים הנתונים האחרונים שנשמרו במכשיר."};
      displayResult(stale);
      setState("success");
      if (window.HaniaDataStatus) HaniaDataStatus.report("raam", {title:"תקלה במקור NASA — DATA1–DATA4 אינם מעודכנים", message:"מוצגים הנתונים האחרונים שנשמרו במכשיר.", lastUpdated:previous.updated_at || previous.saved_at, severity:"error"});
      showToast("מוצגים נתוני RAAM אחרונים שמורים");
    } else {
      elements.errorText.textContent = rawMessage.includes("Earthdata") || rawMessage.includes("CDDIS")
        ? "מקור נתוני BRDC אינו זמין כרגע ולא נמצאו נתונים שמורים להצגה."
        : rawMessage;
      setState("error");
      if (window.HaniaDataStatus) HaniaDataStatus.report("raam", {title:"תקלה במקור NASA — אין נתונים מעודכנים", message:elements.errorText.textContent, severity:"error"});
    }
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
  elements.comparisonTitle.textContent = `${current.source_date} לעומת ${previous.source_date}`;
  elements.comparisonSummary.textContent = changedCount ? `${changedCount} ערכים השתנו` : "לא חל שינוי בערכי RAAM";
  elements.comparisonSummary.classList.toggle("no-change", changedCount === 0);
  elements.comparisonGrid.innerHTML = changes.map(item => {
    const sign = item.delta > 0 ? "+" : "";
    const direction = item.delta > 0 ? "up" : item.delta < 0 ? "down" : "same";
    return `<div class="comparison-value ${direction}"><span>${item.key.toUpperCase()}</span><strong>${item.now}</strong><small>${item.changed ? `${sign}${item.delta} from ${item.before}` : `ללא שינוי לעומת ${item.before}`}</small></div>`;
  }).join("");
}

function renderHistory() {
  if (!elements.historyList) return;
  const history = loadHistory();
  elements.historyCount.textContent = `${history.length} תוצאות`;
  elements.historyEmpty.classList.toggle("hidden", history.length > 0);
  elements.historyContent.classList.toggle("hidden", history.length === 0);
  elements.clearHistoryButton.disabled = history.length === 0;
  if (!history.length) {
    elements.historyList.innerHTML = "";
    elements.comparisonCard.classList.add("hidden");
    elements.historyShowcaseEmpty?.classList.remove("hidden");
    elements.historyShowcaseContent?.classList.add("hidden");
    renderAnalytics();
    return;
  }

  elements.historyShowcaseEmpty?.classList.add("hidden");
  elements.historyShowcaseContent?.classList.remove("hidden");
  const latest = history[0];
  const previousLatest = history[1];
  const showcaseKeys = ["data1", "data2", "data3", "data4", "tls"];
  const showcaseChanged = previousLatest ? showcaseKeys.filter(key => Number(latest[key]) !== Number(previousLatest[key])).length : null;
  if (elements.showcaseLatestDate) elements.showcaseLatestDate.textContent = latest.source_date || "—";
  if (elements.showcaseChangeStatus) {
    elements.showcaseChangeStatus.textContent = previousLatest ? (showcaseChanged ? `${showcaseChanged} value${showcaseChanged === 1 ? "" : "s"} changed` : "ללא שינוי") : "תוצאת בסיס";
    elements.showcaseChangeStatus.classList.toggle("no-change", showcaseChanged === 0);
  }
  if (elements.showcaseSavedTime) elements.showcaseSavedTime.textContent = `Saved ${formatSavedTime(latest.saved_at)}`;
  if (elements.historyShowcaseValues) {
    elements.historyShowcaseValues.innerHTML = showcaseKeys.map(key => {
      const now = Number(latest[key]);
      const before = previousLatest ? Number(previousLatest[key]) : null;
      const delta = previousLatest ? now - before : null;
      const changed = previousLatest ? delta !== 0 : false;
      const deltaText = previousLatest ? (changed ? `${delta > 0 ? "+" : ""}${delta}` : "unchanged") : "baseline";
      const direction = !previousLatest ? "baseline" : delta > 0 ? "up" : delta < 0 ? "down" : "same";
      return `<div class="history-showcase-value ${direction}"><span>${key.toUpperCase()}</span><strong>${now}</strong><small>${deltaText}</small></div>`;
    }).join("");
  }

  elements.historyList.innerHTML = history.map((entry, index) => {
    const previous = history[index + 1];
    const changed = previous ? ["data1", "data2", "data3", "data4", "tls"].filter(key => Number(entry[key]) !== Number(previous[key])).length : null;
    const changeText = previous ? (changed ? `${changed} השתנו` : "ללא שינוי") : "תוצאת בסיס";
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
          ${previous ? `<button type="button" class="text-button history-compare" data-index="${index}">השווה</button>` : ""}
          <button type="button" class="text-button history-open" data-index="${index}">פתח</button>
          <button type="button" class="text-button history-download" data-index="${index}">JSON</button>
          <button type="button" class="text-button history-delete" data-index="${index}" aria-label="Delete saved result">מחק</button>
        </div>
      </div>
    </article>`;
  }).join("");

  renderComparison(history, 0);
  renderAnalytics();
}

function openHistoryResult(index) {
  const entry = loadHistory()[index];
  if (!entry) return;
  displayResult(entry);
  setState("success");
  elements.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(`נפתחה תוצאה מתאריך ${entry.source_date}`);
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


async function shareResult() {
  if (!latestResult) return;
  const text = buildTextExport();
  const title = `HaniaION RAAM — ${latestResult.source_date || "Latest result"}`;
  try {
    // Text sharing is supported more consistently than file sharing across mobile browsers.
    if (navigator.share) {
      await navigator.share({ title, text });
      return;
    }
    await copyText(text, "הנתונים הועתקו — ניתן להדביק בוואטסאפ או במייל");
  } catch (error) {
    if (error?.name === "AbortError") return;
    // Some installed PWAs expose navigator.share but reject it. Never leave the user stuck.
    try {
      await copyText(text, "חלון השיתוף לא נפתח, לכן הנתונים הועתקו ללוח");
    } catch (_) {
      showToast("לא ניתן לשתף כרגע. ניתן להוריד RAAM.txt");
    }
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = "dark";
  localStorage.setItem("haniaion-theme", "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#07111f");
}

function initializeTheme() {
  applyTheme();
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
  setLiveStatus("nasaStatusCard", "nasaStatus", "nasaLatency", "checking", "בודק", "חיבור לשרת");
  setLiveStatus("databaseStatusCard", "databaseStatus", "databaseDetail", "checking", "בודק", "PostgreSQL");
  setLiveStatus("satelliteStatusCard", "satelliteStatus", "satelliteDetail", "checking", "בודק", "מקור מסלולים");
  setLiveStatus("windStatusCard", "windStatus", "windDetail", "neutral", "זמין", "מפת הרוח נפתחת בנפרד");
  setLiveStatus("k69StatusCard", "k69Status", "k69Detail", "online", "מחושב מקומית", "שעון המכשיר");
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("offline");
    const payload = await response.json();
    const latency = Math.max(1, Math.round(performance.now() - started));
    elements.serviceStatus.classList.add("online");
    elements.serviceStatus.classList.remove("offline");
    elements.serviceStatusText.textContent = payload.status === "degraded" ? "שירות פעיל חלקית" : "השירות תקין";
    setLiveStatus("nasaStatusCard", "nasaStatus", "nasaLatency", "online", "נגיש", `${latency} ms`);
    const db = payload.database || {};
    if (db.connected) setLiveStatus("databaseStatusCard", "databaseStatus", "databaseDetail", "online", "מחובר", "היסטוריה בענן פעילה");
    else if (!db.enabled) setLiveStatus("databaseStatusCard", "databaseStatus", "databaseDetail", "neutral", "לא מוגדר", "נשמר מקומית בלבד");
    else setLiveStatus("databaseStatusCard", "databaseStatus", "databaseDetail", "offline", "תקלה", "היסטוריה בענן אינה זמינה");
  } catch {
    elements.serviceStatus.classList.add("offline");
    elements.serviceStatus.classList.remove("online");
    elements.serviceStatusText.textContent = "השירות אינו זמין";
    setLiveStatus("nasaStatusCard", "nasaStatus", "nasaLatency", "offline", "לא זמין", "בדיקת השרת נכשלה");
    setLiveStatus("databaseStatusCard", "databaseStatus", "databaseDetail", "offline", "לא ידוע", "לא ניתן לבדוק");
  }
  try {
    const response = await fetch("/api/satellites/coverage?minutes=5", { cache: "no-store" });
    if (!response.ok) throw new Error("offline");
    const payload = await response.json();
    const live = payload.source_mode === "live";
    const hasObjects = Number(payload.counts?.total || 0) > 0;
    setLiveStatus("satelliteStatusCard", "satelliteStatus", "satelliteDetail", live ? "online" : hasObjects ? "warning" : "neutral", live ? "חי" : hasObjects ? "מטמון פעיל" : "ממתין לעדכון", payload.tle_fetched_at ? `TLE: ${formatDateTime(payload.tle_fetched_at)}` : "מקור מסלולים");
  } catch {
    setLiveStatus("satelliteStatusCard", "satelliteStatus", "satelliteDetail", "neutral", "ממתין לעדכון", "מקור המסלולים אינו זמין כרגע");
  }
}

function registerEvents() {
  elements.calculateButton?.addEventListener("click", () => calculate());
  elements.heroCalculateButton?.addEventListener("click", () => calculate({ scrollToWorkspace: true }));
  byId("commandCalculateButton")?.addEventListener("click", () => calculate({ scrollToWorkspace: true }));
  elements.refreshButton.addEventListener("click", () => calculate());
  elements.retryButton.addEventListener("click", () => calculate());
  elements.copyButton.addEventListener("click", () => latestResult && copyText(buildTextExport(), "All RAAM values copied"));
  elements.downloadTxtButton.addEventListener("click", exportTxt);
  elements.downloadJsonButton.addEventListener("click", exportJson);
  elements.downloadCsvButton.addEventListener("click", exportCsv);
  elements.shareResultButton?.addEventListener("click", shareResult);
  elements.viewResultsButton.addEventListener("click", () => scrollToTarget("raam-values-target", "start", 132));


  document.querySelectorAll('a[href="#k69-live-target"]').forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      scrollToTarget("k69-live-target", "start", 92);
      history.replaceState(null, "", "#k69-live-target");
    });
  });

  document.querySelectorAll('a[href="#gnss-action-target"]').forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      scrollToTarget("gnss-action-target", "start", 112);
      history.replaceState(null, "", "#gnss-action-target");
    });
  });

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


function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(character => character.charCodeAt(0)));
}

async function currentPushSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function refreshNotificationUi() {
  if (!elements.notificationButton) return;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) {
    elements.notificationStatus.textContent = "הדפדפן הזה אינו תומך בהתראות Push";
    elements.notificationButton.disabled = true;
    return;
  }
  const subscription = await currentPushSubscription();
  const enabled = Boolean(subscription) && Notification.permission === "granted";
  elements.notificationStatus.textContent = enabled ? "ההתראות פעילות" : "ההתראות כבויות";
  elements.notificationButton.textContent = enabled ? "בטל התראות" : "הפעל התראות";
  elements.notificationButton.dataset.enabled = enabled ? "true" : "false";
}

async function toggleNotifications() {
  elements.notificationButton.disabled = true;
  try {
    const existing = await currentPushSubscription();
    if (existing) {
      await fetch("/api/push/unsubscribe", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({endpoint: existing.endpoint})});
      await existing.unsubscribe();
      showToast("ההתראות בוטלו");
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("לא ניתן אישור לקבלת התראות");
      const keyResponse = await fetch("/api/push/public-key");
      if (!keyResponse.ok) throw new Error("שירות ההתראות עדיין לא הוגדר בשרת");
      const {public_key: publicKey} = await keyResponse.json();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey)});
      const saveResponse = await fetch("/api/push/subscribe", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(subscription)});
      if (!saveResponse.ok) {
        await subscription.unsubscribe();
        throw new Error("לא ניתן לשמור את רישום ההתראות");
      }
      showToast("ההתראות הופעלו");
    }
  } catch (error) {
    showToast(error.message || "הפעלת ההתראות נכשלה");
  } finally {
    elements.notificationButton.disabled = false;
    await refreshNotificationUi();
  }
}

async function refreshMonitorStatus() {
  if (!elements.monitorStatus) return;
  try {
    const response = await fetch("/api/monitor/status", {cache: "no-store"});
    const payload = await response.json();
    if (!response.ok) throw new Error("monitor unavailable");
    const state = payload.state || {};
    const format = value => value ? formatDateTime(value) : "—";
    const lastFile = state.last_remote_file_name || state.last_file_name || "טרם נקבע קובץ בסיס";
    elements.latestMonitorFile.textContent = lastFile;
    elements.lastMonitorCheck.textContent = format(state.last_check_at);
    elements.nextMonitorCheck.textContent = format(payload.next_check_at);
    elements.lastMonitorChange.textContent = format(state.last_change_at || state.last_notification_at);
    const databaseEnabled = Boolean(payload.database?.enabled);
    const pushConfigured = Boolean(payload.push?.configured);
    elements.monitorBadge.textContent = databaseEnabled ? "ניטור פעיל" : "מוכן להגדרה";
    elements.monitorStatus.textContent = databaseEnabled
      ? `הבדיקה מתבצעת כל 3 שעות. ${pushConfigured ? "שירות Push מוכן." : "יש להוסיף מפתחות Push ב־Render."}`
      : "האתר עובד כרגיל. להפעלת ניטור אוטומטי והתראות יש לחבר DATABASE_URL ומפתחות VAPID ב־Render.";
    if (elements.notificationDescription) {
      elements.notificationDescription.textContent = pushConfigured
        ? "קבלת התראה רק כאשר מתפרסם קובץ BRDC חדש. ניתן להפעיל או לבטל בכל עת."
        : "הכפתור יהיה זמין לאחר הגדרת מסד הנתונים ומפתחות ההתראות ב־Render.";
    }
    if (!pushConfigured && elements.notificationButton) {
      elements.notificationButton.disabled = true;
      elements.notificationStatus.textContent = "שירות ההתראות ממתין להגדרה";
    } else if (elements.notificationButton) {
      elements.notificationButton.disabled = false;
      refreshNotificationUi().catch(() => {});
    }
  } catch {
    elements.monitorStatus.textContent = "מצב הניטור אינו זמין כרגע. פעולת RAAM הידנית ממשיכה לעבוד.";
    elements.monitorBadge.textContent = "לא זמין";
  }
}

function initializeNotifications() {
  elements.notificationButton?.addEventListener("click", toggleNotifications);
  refreshNotificationUi().catch(() => {});
  refreshMonitorStatus();
  setInterval(refreshMonitorStatus, 60000);
}


function updateUtcClock() {
  if (elements.utcClock) elements.utcClock.textContent = new Date().toISOString().slice(11, 19);
}


function cloudHistoryEntry(item) {
  return {
    ...item,
    id: item.id ? `cloud-${item.id}` : `${item.source_date || "unknown"}-${item.updated_at || Date.now()}`,
    saved_at: item.checked_at || item.updated_at || new Date().toISOString(),
    cached: false,
    cloud: true,
  };
}

function historyIdentity(item) {
  return [item.source_date, item.data1, item.data2, item.data3, item.data4, item.tls].join("|");
}

async function syncCloudHistory({announce = false} = {}) {
  if (elements.cloudHistoryStatus) elements.cloudHistoryStatus.textContent = "מסנכרן היסטוריה מהענן...";
  if (elements.syncHistoryButton) elements.syncHistoryButton.disabled = true;
  try {
    const response = await fetch("/api/history?limit=100", {cache: "no-store"});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload.database_enabled) {
      if (elements.cloudHistoryStatus) elements.cloudHistoryStatus.textContent = "היסטוריית הענן אינה מוגדרת; מוצגות תוצאות מהמכשיר.";
      return;
    }
    const local = loadHistory();
    const merged = [];
    const seen = new Set();
    [...(payload.items || []).map(cloudHistoryEntry), ...local]
      .sort((a,b) => new Date(b.saved_at || b.updated_at || 0) - new Date(a.saved_at || a.updated_at || 0))
      .forEach(item => {
        const key = historyIdentity(item);
        if (!seen.has(key)) { seen.add(key); merged.push(item); }
      });
    saveHistory(merged);
    renderHistory();
    renderAnalytics();
    if (elements.cloudHistoryStatus) {
      elements.cloudHistoryStatus.textContent = `${payload.count || 0} תוצאות ענן סונכרנו · סה״כ ${merged.length} תוצאות זמינות`;
    }
    if (announce) showToast("היסטוריית הענן סונכרנה");
  } catch (error) {
    if (elements.cloudHistoryStatus) elements.cloudHistoryStatus.textContent = "לא ניתן לסנכרן כרגע; מוצגות התוצאות השמורות במכשיר.";
    if (announce) showToast("סנכרון ההיסטוריה לא הושלם");
  } finally {
    if (elements.syncHistoryButton) elements.syncHistoryButton.disabled = false;
  }
}

function historyChangeCount(history) {
  let count = 0;
  for (let i = 0; i < history.length - 1; i += 1) {
    if (!["data1", "data2", "data3", "data4", "tls"].every(key => Number(history[i][key]) === Number(history[i + 1][key]))) count += 1;
  }
  return count;
}

function formatChartValue(value) {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? value.toLocaleString("he-IL") : value.toLocaleString("he-IL", {maximumFractionDigits: 2});
}

function renderAnalytics() {
  if (!elements.historyChart) return;
  const allHistory = loadHistory();
  const rangeValue = elements.chartRange?.value || "30";
  const limit = rangeValue === "all" ? allHistory.length : Number(rangeValue);
  const history = allHistory.slice(0, limit).reverse();
  const metric = elements.chartMetric?.value || "data1";
  elements.analyticsCount.textContent = String(allHistory.length);
  elements.analyticsChanges.textContent = String(historyChangeCount(allHistory));
  const hourCounts = {};
  allHistory.forEach(item => { const d = new Date(item.saved_at); if (!Number.isNaN(d.getTime())) hourCounts[d.getUTCHours()] = (hourCounts[d.getUTCHours()] || 0) + 1; });
  const commonHour = Object.entries(hourCounts).sort((a,b)=>b[1]-a[1])[0]?.[0];
  elements.analyticsCommonHour.textContent = commonHour === undefined ? "—" : `${String(commonHour).padStart(2,"0")}:00 UTC`;
  let stableRun = 0;
  for (let i = 0; i < allHistory.length - 1; i += 1) {
    if (sameResult(allHistory[i], allHistory[i+1])) stableRun += 1; else break;
  }
  elements.analyticsStableRun.textContent = String(stableRun);
  const canvas = elements.historyChart;
  const empty = elements.chartEmpty;
  const insight = elements.chartInsight;
  if (history.length < 2) {
    canvas.classList.add("hidden"); empty.classList.remove("hidden"); insight?.classList.add("hidden");
    [elements.chartMinimum, elements.chartMaximum, elements.chartDelta].forEach(el => { if (el) el.textContent = "—"; });
    return;
  }
  const values = history.map(item => Number(item[metric])).filter(Number.isFinite);
  if (values.length < 2) {
    canvas.classList.add("hidden"); empty.classList.remove("hidden");
    empty.textContent = "אין מספיק ערכים תקינים להצגת הגרף.";
    return;
  }
  const actualMin = Math.min(...values), actualMax = Math.max(...values);
  const delta = values.at(-1) - values[0];
  if (elements.chartMinimum) elements.chartMinimum.textContent = formatChartValue(actualMin);
  if (elements.chartMaximum) elements.chartMaximum.textContent = formatChartValue(actualMax);
  if (elements.chartDelta) elements.chartDelta.textContent = `${delta > 0 ? "+" : ""}${formatChartValue(delta)}`;
  const isFlat = actualMax === actualMin;
  if (insight) {
    insight.textContent = isFlat
      ? `לא זוהה שינוי ב־${metric.toUpperCase()} בין ${history.length} התוצאות שנבחרו.`
      : `השינוי בטווח שנבחר: ${delta > 0 ? "+" : ""}${formatChartValue(delta)}.`;
    insight.classList.remove("hidden");
    insight.classList.toggle("stable", isFlat);
  }
  canvas.classList.remove("hidden"); empty.classList.add("hidden");
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const cssWidth = Math.max(260, canvas.parentElement.clientWidth - 28);
  const cssHeight = cssWidth < 430 ? 300 : 330;
  canvas.width = cssWidth * ratio; canvas.height = cssHeight * ratio;
  canvas.style.width = `${cssWidth}px`; canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d"); ctx.setTransform(ratio,0,0,ratio,0,0);
  const axisPadding = isFlat ? Math.max(1, Math.abs(actualMax) * 0.02) : 0;
  const min = isFlat ? actualMin - axisPadding : actualMin;
  const max = isFlat ? actualMax + axisPadding : actualMax;
  const spread = max - min || 1;
  ctx.font = "12px system-ui";
  const labels = Array.from({length:5}, (_,i) => formatChartValue(max-spread*i/4));
  const widest = Math.max(...labels.map(label => ctx.measureText(label).width));
  const pad = {left:Math.max(58, Math.ceil(widest)+18),right:18,top:24,bottom:48};
  const w = Math.max(40, cssWidth-pad.left-pad.right), h=cssHeight-pad.top-pad.bottom;
  const isLight = document.documentElement.dataset.theme === "light";
  ctx.clearRect(0,0,cssWidth,cssHeight);
  ctx.strokeStyle = isLight ? "rgba(30,70,100,.16)" : "rgba(120,210,255,.14)";
  ctx.fillStyle = isLight ? "#52677c" : "#b7ccdc";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for(let i=0;i<=4;i++){
    const y=pad.top+h*i/4;
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(pad.left+w,y);ctx.stroke();
    ctx.fillText(labels[i],pad.left-9,y);
  }
  const points=values.map((v,i)=>({x:pad.left+(values.length===1?0:w*i/(values.length-1)),y:pad.top+(max-v)/spread*h}));
  const gradient=ctx.createLinearGradient(0,pad.top,0,pad.top+h);gradient.addColorStop(0,"rgba(57,211,255,.30)");gradient.addColorStop(1,"rgba(57,211,255,0)");
  ctx.beginPath();ctx.moveTo(points[0].x,pad.top+h);points.forEach(p=>ctx.lineTo(p.x,p.y));ctx.lineTo(points.at(-1).x,pad.top+h);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle="#39d3ff";ctx.lineWidth=3;ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  points.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle="#65dcff";ctx.fill();if(i===0||i===points.length-1){const label=history[i].source_date||"";ctx.fillStyle=isLight?"#52677c":"#9cb7cc";ctx.fillText(label,p.x,cssHeight-16);}});
}

function exportHistoryCsv() {
  const history = loadHistory();
  if (!history.length) { showToast("אין היסטוריה לייצוא"); return; }
  const header=["saved_at","file_name","source_date","data1","data2","data3","data4","tls"];
  const rows=[header,...history.map(item=>header.map(key=>item[key]??""))];
  const csv=rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\n");
  downloadBlob(csv,"HaniaION-history.csv","text/csv;charset=utf-8");
  showToast("קובץ ההיסטוריה נוצר");
}

elements.chartMetric?.addEventListener("change", renderAnalytics);
elements.chartRange?.addEventListener("change", renderAnalytics);
elements.exportHistoryCsvButton?.addEventListener("click", exportHistoryCsv);
elements.syncHistoryButton?.addEventListener("click", () => syncCloudHistory({announce:true}));
window.addEventListener("resize", () => { clearTimeout(window.__haniaChartTimer); window.__haniaChartTimer=setTimeout(renderAnalytics,150); });
updateUtcClock(); setInterval(updateUtcClock, 1000);


function initializeFloatingTopButton() {
  const button = byId("floatingTopButton");
  if (!button) return;
  const update = () => button.classList.toggle("visible", window.scrollY > 520);
  window.addEventListener("scroll", update, {passive: true});
  button.addEventListener("click", () => byId("quick-menu")?.scrollIntoView({behavior: "smooth", block: "start"}));
  update();
}
initializeTheme();
initializeFloatingTopButton();
registerEvents();
registerHistoryEvents();
renderHistory();
syncCloudHistory().catch(() => {});
registerServiceWorker();
initializeInstallExperience();
initializePremiumMotion();
initializeNotifications();
checkHealth();
setInterval(checkHealth, 60000);



const K69_INTERVAL_MS = 12.5 * 60 * 1000;
const K69_ANCHOR_UTC = {hour: 0, minute: 9, second: 11};

function getK69WeeklyAnchorUtc(currentTime) {
  const dayOfWeekUtc = currentTime.getUTCDay();
  return new Date(Date.UTC(
    currentTime.getUTCFullYear(),
    currentTime.getUTCMonth(),
    currentTime.getUTCDate() - dayOfWeekUtc,
    K69_ANCHOR_UTC.hour,
    K69_ANCHOR_UTC.minute,
    K69_ANCHOR_UTC.second,
    0
  ));
}

function calculateNextK69(currentTime) {
  const weeklyAnchor = getK69WeeklyAnchorUtc(currentTime);
  const elapsed = currentTime.getTime() - weeklyAnchor.getTime();
  const inInterval = ((elapsed % K69_INTERVAL_MS) + K69_INTERVAL_MS) % K69_INTERVAL_MS;
  const toleranceMs = 20;
  const remaining = inInterval <= toleranceMs ? 0 : K69_INTERVAL_MS - inInterval;
  return {next: new Date(currentTime.getTime() + remaining), remaining, weeklyAnchor};
}

function padK69(value) { return String(value).padStart(2, "0"); }
function formatK69Local(date) { return `${padK69(date.getHours())}:${padK69(date.getMinutes())}:${padK69(date.getSeconds())}`; }
function formatK69Utc(date) { return `${padK69(date.getUTCHours())}:${padK69(date.getUTCMinutes())}:${padK69(date.getUTCSeconds())}`; }
function formatK69Countdown(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${padK69(Math.floor(seconds / 60))}:${padK69(seconds % 60)}`;
}

function renderK69Timeline(nextTime) {
  const timeline = byId("k69Timeline");
  if (!timeline) return;
  const items = [-2, -1, 0, 1].map((offset, index) => {
    const eventTime = new Date(nextTime.getTime() + offset * K69_INTERVAL_MS);
    const isNext = offset === 0;
    const label = isNext ? "K הבא" : offset < 0 ? `K ${offset}` : "K +1";
    return `<div class="k69-timeline-item ${isNext ? "is-next" : ""}">
      <span class="k69-timeline-dot"></span>
      <strong>${label}</strong>
      <time>${formatK69Local(eventTime)}</time>
      <small>${formatK69Utc(eventTime)} UTC</small>
    </div>${index < 3 ? '<span class="k69-timeline-line"></span>' : ''}`;
  }).join("");
  timeline.innerHTML = items;
}

function updateK69Monitor() {
  const localTime = byId("k69LocalTime");
  const nowCheck = Date.now();
  if (!Number.isFinite(nowCheck) || nowCheck < 1577836800000) {
    if (window.HaniaDataStatus) HaniaDataStatus.report("k69", {title:"שעון המכשיר אינו תקין — K69 אינו מעודכן", message:"לא ניתן לחשב את אירוע K הבא עד לתיקון התאריך והשעה במכשיר.", severity:"error"});
    if (window.HaniaDataStatus) HaniaDataStatus.setNote("k69SourceNote", {state:"error", title:"בעיה בשעון המכשיר", text:"חישוב K69 הופסק משום שהתאריך או השעה אינם תקינים."});
    return;
  }
  if (window.HaniaDataStatus) { HaniaDataStatus.clear("k69"); HaniaDataStatus.setNote("k69SourceNote", {state:"ok", title:"מקור K69: שעון המכשיר", text:"החישוב מקומי ואינו תלוי בחיבור ל־NASA, ל־Windy או למקור לוויינים.", lastUpdated:new Date(nowCheck).toISOString()}); }
  if (!localTime) return;
  const now = new Date();
  const {next, remaining} = calculateNextK69(now);
  const progress = Math.max(0, Math.min(1, 1 - (remaining / K69_INTERVAL_MS)));
  const ring = byId("k69ProgressRing");

  localTime.textContent = formatK69Local(now);
  byId("k69UtcTime").textContent = formatK69Utc(now);
  byId("k69NextLocal").textContent = formatK69Local(next);
  byId("k69NextUtc").textContent = formatK69Utc(next);
  byId("k69Countdown").textContent = formatK69Countdown(remaining);
  if (byId("k69QuickCountdown")) byId("k69QuickCountdown").textContent = formatK69Countdown(remaining);
  if (byId("k69QuickNext")) byId("k69QuickNext").textContent = formatK69Local(next);
  byId("k69TimeZone").textContent = `אזור זמן: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "לא ידוע"}`;
  byId("k69NextDate").textContent = new Intl.DateTimeFormat("he-IL", {weekday:"short", day:"2-digit", month:"2-digit"}).format(next);
  ring?.style.setProperty("--k69-progress", `${progress * 360}deg`);
  ring?.classList.toggle("k69-warning", remaining <= 5 * 60 * 1000 && remaining > 60 * 1000);
  ring?.classList.toggle("k69-critical", remaining <= 60 * 1000);

  const marker = `${next.getTime()}`;
  if (ring?.dataset.nextMarker !== marker) {
    ring.dataset.nextMarker = marker;
    renderK69Timeline(next);
  }
}

function initializeK69Monitor() {
  if (!byId("k69LocalTime")) return;
  updateK69Monitor();
  window.setInterval(updateK69Monitor, 100);
}

document.addEventListener("DOMContentLoaded", initializeK69Monitor);

// v2.10 — adaptive live GNSS interference check
(() => {
  const $ = id => document.getElementById(id);
  if (!$('gnssTestButton')) return;
  let watchId=null, samples=[], started=0, timer=null, firstFix=false, lastSampleAt=0;
  const button=$('gnssTestButton');
  const dist=(a,b)=>{const R=6371000,p=Math.PI/180,dLat=(b.latitude-a.latitude)*p,dLon=(b.longitude-a.longitude)*p,x=Math.sin(dLat/2)**2+Math.cos(a.latitude*p)*Math.cos(b.latitude*p)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));};
  const setLive=(title,text)=>{const el=$('gnssLiveStatus'); if(el) el.innerHTML=`<strong>${title}</strong><span>${text}</span>`;};
  const progressEl=$('gnssTestProgress'),stageEl=$('gnssTestStage'),etaEl=$('gnssTestEta'),metaEl=$('gnssTestProgressMeta'),progressBar=$('gnssTestProgressBar');
  function showProgress(show=true){if(progressEl)progressEl.classList.toggle('hidden',!show);}
  function updateProgress(m){
    if(!progressEl)return;
    const elapsed=m?m.elapsed:0, count=samples.length, conf=m?m.confidence:0;
    let stage='מחפש GPS…', stageProgress=8;
    if(firstFix){stage='אוסף דגימות';stageProgress=Math.min(68,18 + count*5);}
    if(count>=6){stage='מאמת יציבות';stageProgress=Math.max(stageProgress,Math.min(88,58 + conf*.3));}
    if(count>=8&&conf>=70){stage='מסיים ניתוח';stageProgress=Math.max(stageProgress,92);}
    const remain=Math.max(0,Math.ceil(22-elapsed));
    if(stageEl)stageEl.textContent=stage;
    if(metaEl)metaEl.textContent=`${count} דגימות · ביטחון ${conf||0}%`;
    if(etaEl)etaEl.textContent=firstFix ? (remain>0?`זמן משוער: עד ${remain} שנ׳`:'עשוי להסתיים בכל רגע') : 'ממתין ל־Fix ראשון';
    if(progressBar)progressBar.style.width=`${Math.min(96,stageProgress)}%`;
  }
  function resetButton(){button.disabled=false;button.textContent='📱 בדוק GPS עכשיו';}
  function stopWatch(){if(watchId!==null) navigator.geolocation.clearWatch(watchId);if(timer)clearInterval(timer);watchId=null;timer=null;}
  function metrics(){
    if(!samples.length)return null;
    const acc=samples.map(s=>s.accuracy).filter(Number.isFinite), accuracy=acc.reduce((a,b)=>a+b,0)/acc.length;
    let jumps=0;for(let i=1;i<samples.length;i++){const dt=(samples[i].t-samples[i-1].t)/1000,d=dist(samples[i-1],samples[i]);if(dt<8&&d>Math.max(80,samples[i].accuracy*4))jumps++;}
    const elapsed=Math.max(1,(Date.now()-started)/1000), expected=Math.max(samples.length,Math.ceil(elapsed/3));
    const fixRatio=Math.min(1,samples.length/expected);
    const native=window.haniaionNativeGnss||null;
    let nativeScore=0, nativeReady=false, nativePoorSky=false, nativeHealthy=false;
    if(native){
      const view=Number(native.satellitesInView)||0, used=Number(native.satellitesUsed)||0, cn0=Number(native.avgCn0DbHz)||0, nAcc=Number(native.accuracyM)||0;
      const usedRatio=view>0?used/view:0;
      nativeReady=view>=4;
      nativePoorSky=nativeReady && ((cn0>0&&cn0<16) || used<=2 || (view>=12&&usedRatio<0.06) || nAcc>35);
      nativeHealthy=nativeReady && used>=4 && cn0>=18 && nAcc>0 && nAcc<=20;
      if(nativeReady){
        if(cn0>0&&cn0<16) nativeScore+=18; else if(cn0>0&&cn0<20) nativeScore+=7;
        if(view>=12&&used<=1) nativeScore+=22; else if(view>=12&&usedRatio<0.10) nativeScore+=10;
        if(nAcc>35) nativeScore+=12; else if(nAcc>20) nativeScore+=5;
        if(nativeHealthy) nativeScore-=8;
      }
    }
    const browserScore=Math.min(100,Math.max(0,accuracy-8)*1.15+(1-fixRatio)*45+jumps*18);
    const score=Math.round(Math.min(100,Math.max(0,browserScore + nativeScore)));
    const baseConfidence=samples.length*5+Math.min(elapsed,20)*1.5;
    const confidence=Math.min(99,Math.round(baseConfidence+(nativeReady?10:0)));
    return {accuracy,jumps,fixRatio,score,confidence,elapsed,native,nativeReady,nativePoorSky,nativeHealthy,nativeScore};
  }
  function paint(m){
    if(!m)return;
    $('gnssAccuracy').textContent=`±${m.accuracy.toFixed(1)} m`;$('gnssFix').textContent=`${Math.round(m.fixRatio*100)}%`;$('gnssJumps').textContent=String(m.jumps);$('gnssScore').textContent=`${m.score}/100`;$('gnssMeter').style.width=`${m.score}%`;
    if($('gnssSamples'))$('gnssSamples').textContent=String(samples.length);if($('gnssConfidence'))$('gnssConfidence').textContent=`${m.confidence}%`;
    const tag=(id,text,cls)=>{const e=$(id);if(e){e.textContent=text;e.className='gnss-class '+cls;}};
    tag('gnssAccuracyClass',m.accuracy<=12?'טוב':m.accuracy<=30?'בינוני':'חלש',m.accuracy<=12?'good':m.accuracy<=30?'mid':'bad');
    const fp=Math.round(m.fixRatio*100);tag('gnssFixClass',fp>=80?'יציבה':fp>=55?'חלקית':'לא יציבה',fp>=80?'good':fp>=55?'mid':'bad');
    tag('gnssJumpsClass',m.jumps===0?'תקין':m.jumps<=1?'לבדיקה':'חשוד',m.jumps===0?'good':m.jumps<=1?'mid':'bad');
    tag('gnssScoreClass',m.score<30?'נמוך':m.score<60?'בינוני':'גבוה',m.score<30?'good':m.score<60?'mid':'bad');
    tag('gnssSamplesClass',samples.length>=8?'מספיק':'מעט',samples.length>=8?'good':'mid');
    tag('gnssConfidenceClass',m.confidence>=80?'גבוה':m.confidence>=60?'בינוני':'נמוך',m.confidence>=80?'good':m.confidence>=60?'mid':'bad');
  }
  function permissionError(err){stopWatch();showProgress(false);resetButton();const denied=err&&err.code===1;$('gnssBadge').className='gnss-badge neutral';$('gnssBadge').textContent=denied?'נדרשת הרשאה':'קליטה לא מספקת';const text=denied?'הדפדפן חסם גישה למיקום. אפשר Location לאתר דרך הגדרות האתר ונסה שוב.':'לא התקבל Fix אמין. עבור לאזור פתוח עם קו ראייה לשמיים ללא חסימה ונסה שוב.';$('gnssReason').textContent=text;setLive(denied?'נדרשת הרשאת מיקום':'אין מספיק קליטת GPS',text);}
  async function regional(lat,lon,share,score,accuracy,fixRatio){const latCell=Math.round(lat*10)/10,lonCell=Math.round(lon*10)/10;try{if(share)await fetch('/api/gnss/sample',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat_cell:latCell,lon_cell:lonCell,score,accuracy_m:accuracy,fix_ratio:fixRatio})});const r=await fetch(`/api/gnss/region?lat_cell=${latCell}&lon_cell=${lonCell}`,{cache:'no-store'}),d=await r.json();if(!d.count){$('regionalGnss').textContent='אין מספיק מדידות באזור';return;}$('regionalGnss').textContent=`${d.score<30?'🟢 רגוע':d.score<60?'🟡 הפרעות אפשריות':'🟠 סימנים חריגים'} · ${d.score}/100`;$('regionalGnssDetail').textContent=`${d.count} מדידות ב־2 השעות האחרונות · דיוק ממוצע ±${d.accuracy_m} מ׳.`;}catch(e){$('regionalGnss').textContent='התמונה הקהילתית אינה זמינה כרגע';}}
  function finish(forced=false){const m=metrics();stopWatch();if(progressBar)progressBar.style.width='100%';if(stageEl)stageEl.textContent='הבדיקה הושלמה';if(etaEl)etaEl.textContent='הסתיים';resetButton();if(!m||samples.length<4){$('gnssBadge').textContent='אין מספיק מידע';$('gnssReason').textContent='לא התקבלו מספיק דגימות. עבור למקום פתוח לשמיים ונסה שוב.';setLive('אין מספיק מידע','עבור לאזור פתוח עם קו ראייה לשמיים ללא חסימה ונסה שוב.');return;}
    paint(m);const poorSky=m.accuracy>35 || m.fixRatio<.55 || (m.nativeReady&&m.nativePoorSky&&m.score<60);
    let title,reason,cls;
    const nativeLabel=m.nativeReady?' · Android GNSS שולב':'';
    if(poorSky){title='קליטה לא מספקת לקביעה';reason=m.nativeReady?'נתוני Android GNSS מצביעים על Fix חלש או חסימת שמיים אפשרית. עבור למקום פתוח לשמיים ונסה שוב לפני שמסיקים שיש הפרעה.':'איכות ה־GPS נמוכה. ייתכן שאתה בתוך מבנה, ברכב מקורה או עם חסימת שמיים. עבור לאזור פתוח לשמיים ונסה שוב.';cls='warn';}
    else if(m.score<30){title='לא זוהתה הפרעת GPS';reason=m.nativeReady?'בדיקת המיקום ונתוני הלוויינים של Android עקביים: יש Fix שימושי, הדיוק יציב ולא זוהו סימנים משמעותיים להפרעה.':'ה־Fix יציב והדיוק עקבי. לא זוהו סימנים משמעותיים לחסימה או הפרעה במהלך הבדיקה.';cls='ok';}
    else if(m.score<60){title='אי־יציבות ב־GNSS — מומלץ לבדוק שוב';reason=m.nativeReady?'נמצאה אי־יציבות בחלק מהמדדים. נתוני הלוויינים שולבו בתוצאה, אך עדיין לא ניתן להבדיל בוודאות בין תנאי קליטה סביבתיים לבין הפרעה חיצונית.':'נמצאו סימנים לאי־יציבות. מומלץ לחזור על הבדיקה במקום פתוח לשמיים כדי לשלול חסימת קליטה סביבתית.';cls='warn';}
    else{title='סימנים חריגים ב־GNSS';reason=m.nativeReady?'גם מדדי המיקום וגם נתוני Android GNSS מציגים חריגות. זו אינדיקציה להפרעה אפשרית בלבד — לא הוכחה לחסימה או להטעיה מכוונת.':'נמצאו חריגות משמעותיות במדדי המיקום. זו אינדיקציה להפרעה, לא הוכחה לחסימה מכוונת.';cls='alert';}
    $('gnssBadge').className='gnss-badge '+cls;$('gnssBadge').textContent=title;$('gnssReason').textContent=reason;setLive(title,`${samples.length} דגימות נותחו · ביטחון ${m.confidence}%${nativeLabel}`);const last=samples[samples.length-1];regional(last.latitude,last.longitude,$('gnssShare').checked,m.score,m.accuracy,m.fixRatio);
  }
  function maybeFinish(){const m=metrics();if(!m)return;paint(m);const enoughNative=m.nativeReady&&samples.length>=6&&m.elapsed>=10&&m.confidence>=70&&m.accuracy<=25&&Number(m.native?.satellitesUsed||0)>=4;const enoughStable=samples.length>=8&&m.elapsed>=15&&m.confidence>=75&&m.accuracy<=25;const enoughAny=samples.length>=12&&m.elapsed>=22&&m.confidence>=82;if(enoughNative||enoughStable||enoughAny)finish();}
  function begin(){if(firstFix)return;firstFix=true;started=Date.now();updateProgress(metrics());scrollToTarget('gnss-status-target','start',112);setLive('בודק GPS בזמן אמת','אוסף דגימות ומעריך אם כבר יש מספיק מידע.');timer=setInterval(()=>{const m=metrics();if(m){paint(m);updateProgress(m);button.textContent=`בודק… ${samples.length} דגימות`;if(m.elapsed>=45)finish(true);else maybeFinish();}},1000);}
  button.addEventListener('click',()=>{if(!navigator.geolocation){$('gnssReason').textContent='הדפדפן אינו תומך בבדיקת מיקום.';return;}samples=[];firstFix=false;lastSampleAt=0;button.disabled=true;button.textContent='📍 מבקש הרשאת מיקום…';showProgress(true);updateProgress(null);setLive('ממתין להרשאה','הרשאת Location נדרשת רק לבדיקה המקומית.');$('gnssReason').textContent='אשר לדפדפן גישה למיקום. הבדיקה תתחיל רק לאחר Fix ראשון.';watchId=navigator.geolocation.watchPosition(p=>{begin();const now=Date.now();samples.push({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,t:now});lastSampleAt=now;const m=metrics();paint(m);setLive('בודק GPS בזמן אמת',`נאספו ${samples.length} דגימות · ביטחון ${m?m.confidence:0}%`);$('gnssReason').textContent=p.coords.accuracy>35?'הקליטה כרגע חלשה. אם המצב נמשך, עבור לאזור פתוח לשמיים.':'הבדיקה פעילה והמדדים מתעדכנים בזמן אמת.';maybeFinish();},permissionError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});});
})();

// v2.15 — open history/analytics only on demand
document.addEventListener("DOMContentLoaded", () => {
  const openPanel = id => {
    const panel = document.getElementById(id);
    if (!panel) return;
    panel.classList.remove("is-collapsed");
    window.setTimeout(() => scrollToTarget(id, "start", 92), 20);
  };
  const closePanel = id => {
    const panel = document.getElementById(id);
    if (!panel) return;
    panel.classList.add("is-collapsed");
    scrollToTarget("quick-menu", "start", 82);
  };
  document.querySelectorAll("[data-panel-open]").forEach(link => link.addEventListener("click", event => {
    event.preventDefault(); openPanel(link.dataset.panelOpen);
  }));
  document.querySelectorAll("[data-panel-close]").forEach(button => button.addEventListener("click", () => closePanel(button.dataset.panelClose)));
  if (location.hash === "#history" || location.hash === "#analytics") openPanel(location.hash.slice(1));
});

// v2.17 — receive native Android GNSS measurements when running inside HaniaION APK
(() => {
  const panel = document.getElementById("gnss-advanced");
  if (!panel) return;
  let received = 0;
  window.addEventListener("haniaion-native-gnss", event => {
    const d = event.detail || {};
    if (d.source !== "android-native") return;
    window.haniaionNativeGnss = d;
    received += 1;
    panel.classList.remove("hidden");
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set("nativeSatView", Number.isFinite(Number(d.satellitesInView)) ? d.satellitesInView : "—");
    set("nativeSatUsed", Number.isFinite(Number(d.satellitesUsed)) ? d.satellitesUsed : "—");
    set("nativeCn0", Number(d.avgCn0DbHz)>0 ? Number(d.avgCn0DbHz).toFixed(1) : "—");
    set("nativeAccuracy", Number(d.accuracyM)>0 ? `±${Number(d.accuracyM).toFixed(1)} m` : "—");
    const constellations=d.constellations||{};
    const text=Object.entries(constellations).filter(([,n])=>Number(n)>0).map(([name,n])=>`${name} ${n}`).join(" · ");
    set("nativeConstellations", text || "ממתין לזיהוי מערכות");
    const note=document.getElementById("nativeGnssNote");
    if (note) {
    const used = Number(d.satellitesUsed) || 0;
    const view = Number(d.satellitesInView) || 0;
    const cn0 = Number(d.avgCn0DbHz) || 0;
    const acc = Number(d.accuracyM) || 0;

    // נתוני GNSS נוספים שמגיעים מה-Android Native
    const spoofScore = Number(d.spoofScore) || 0;
    const jumpCount = Number(d.jumpCount) || 0;

    let status = "תקין";
    let reason = "לא זוהו סימנים משמעותיים להפרעה";
    let score = spoofScore;

    // חשד להטעיית מיקום
    if (spoofScore >= 60 || jumpCount >= 3) {
        status = "חשד להטעיית מיקום";
        reason = "זוהו חריגות במיקום או בהתנהגות נתוני GNSS";
    }

    // חשד להפרעה / Jamming
    else if (
        (view >= 15 && used <= 2) ||
        (view >= 20 && cn0 > 0 && cn0 < 15)
    ) {
        status = "חשד להפרעת GNSS";
        reason = "נראים לוויינים אך איכות הקליטה או ה-Fix חריגים";
    }

    // קליטה חלשה
    else if (
        used < 4 ||
        (cn0 > 0 && cn0 < 18) ||
        acc > 30
    ) {
        status = "קליטה חלשה";
        reason = "איכות נתוני ה-GNSS אינה מספקת לקביעה חזקה";
    }

    // מצב תקין
    else {
        status = "תקין";

        if (used >= 8 && acc > 0 && acc <= 10) {
            reason = "Fix יציב ודיוק מיקום טוב";
        } else {
            reason = "נתוני GNSS נראים תקינים";
        }
    }

    // לא מאפשרים ציון מחוץ לטווח
    score = Math.max(0, Math.min(100, score));

    const time = new Date(
        Number(d.timestamp) || Date.now()
    ).toLocaleTimeString("he-IL", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

    note.textContent =
        `מצב: ${status} · ${reason} · ` +
        `מדד הטעיה ${Math.round(score)}/100 · ` +
        מדידה #${received} · ${time};
}
  });
})();
