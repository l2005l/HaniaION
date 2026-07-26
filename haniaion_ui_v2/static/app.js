(() => {
  const HISTORY_KEY = "haniaion-history-v2";
  let currentResult = null;

  const $ = (id) => document.getElementById(id);
  const fields = {
    data1: $("data1"), data2: $("data2"), data3: $("data3"), data4: $("data4"), tls: $("tls")
  };

  const pick = (obj, keys) => {
    for (const key of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    }
    return undefined;
  };

  const normalize = (raw) => {
    const payload = raw?.result ?? raw?.data ?? raw;
    return {
      Data1: pick(payload, ["Data1","data1","DATA1"]),
      Data2: pick(payload, ["Data2","data2","DATA2"]),
      Data3: pick(payload, ["Data3","data3","DATA3"]),
      Data4: pick(payload, ["Data4","data4","DATA4"]),
      tLS: pick(payload, ["tLS","tls","TLS","t_ls"]),
      K69: pick(payload, ["K69","k69"]),
      retrievedAt: new Date().toISOString(),
      raw
    };
  };

  const displayValue = (value) => value === undefined || value === null || value === "" ? "—" : String(value);

  function renderResult(result) {
    currentResult = result;
    fields.data1.textContent = displayValue(result.Data1);
    fields.data2.textContent = displayValue(result.Data2);
    fields.data3.textContent = displayValue(result.Data3);
    fields.data4.textContent = displayValue(result.Data4);
    fields.tls.textContent = displayValue(result.tLS);
    $("k69Mini").querySelector("strong").textContent = displayValue(result.K69);
    ["copyBtn","txtBtn","jsonBtn"].forEach(id => $(id).disabled = false);
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch { return []; }
  }

  function saveHistory(result) {
    const history = [result, ...getHistory()].slice(0, 30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const list = $("historyList");
    const history = getHistory();
    if (!history.length) {
      list.innerHTML = '<p class="empty-state">No saved results yet.</p>';
      return;
    }
    list.innerHTML = history.map((item) => `
      <article class="history-item">
        <div class="history-item-top">
          <span class="history-time">${new Date(item.retrievedAt).toLocaleString()}</span>
          <span class="history-k69">K69 ${escapeHtml(displayValue(item.K69))}</span>
        </div>
        <div class="history-values">
          <span>Data1 <strong>${escapeHtml(displayValue(item.Data1))}</strong></span>
          <span>Data2 <strong>${escapeHtml(displayValue(item.Data2))}</strong></span>
          <span>Data3 <strong>${escapeHtml(displayValue(item.Data3))}</strong></span>
          <span>Data4 <strong>${escapeHtml(displayValue(item.Data4))}</strong></span>
          <span>tLS <strong>${escapeHtml(displayValue(item.tLS))}</strong></span>
        </div>
      </article>`).join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }

  function txt(result) {
    return [
      `Retrieved UTC: ${result.retrievedAt}`,
      `Data1: ${displayValue(result.Data1)}`,
      `Data2: ${displayValue(result.Data2)}`,
      `Data3: ${displayValue(result.Data3)}`,
      `Data4: ${displayValue(result.Data4)}`,
      `tLS: ${displayValue(result.tLS)}`,
      `K69: ${displayValue(result.K69)}`
    ].join("\n");
  }

  function download(name, content, type) {
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {href: url, download: name});
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function retrieve() {
    const btn = $("retrieveBtn");
    const message = $("message");
    btn.disabled = true; btn.classList.add("loading");
    message.className = "message"; message.textContent = "Retrieving latest data…";
    try {
      let response = await fetch("/api/calculate", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({})
      });
      if (response.status === 405 || response.status === 422) {
        response = await fetch("/api/calculate", {method:"GET"});
      }
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const raw = await response.json();
      const result = normalize(raw);
      renderResult(result);
      saveHistory(result);
      message.textContent = `Updated at UTC ${result.retrievedAt.slice(11,19)}`;
    } catch (error) {
      message.className = "message error";
      message.textContent = `Could not retrieve data: ${error.message}`;
    } finally {
      btn.disabled = false; btn.classList.remove("loading");
    }
  }

  $("retrieveBtn").addEventListener("click", retrieve);
  $("copyBtn").addEventListener("click", async () => {
    if (!currentResult) return;
    await navigator.clipboard.writeText(txt(currentResult));
    $("message").textContent = "Copied.";
  });
  $("txtBtn").addEventListener("click", () => currentResult && download(`haniaion-${Date.now()}.txt`, txt(currentResult), "text/plain"));
  $("jsonBtn").addEventListener("click", () => currentResult && download(`haniaion-${Date.now()}.json`, JSON.stringify(currentResult.raw, null, 2), "application/json"));
  $("clearHistoryBtn").addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY); renderHistory();
  });

  renderHistory();
})();
