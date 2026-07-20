'use strict';
const $ = id => document.getElementById(id);
const LAST_KEY = 'haniaion_preview_last';
const HISTORY_KEY = 'haniaion_preview_history_v2';
const NEXT_KEY = 'haniaion_preview_next_refresh';
const REFRESH_MS = 3 * 60 * 60 * 1000;
const MAX_HISTORY = 30;
let current = null;
let historyItems = [];
let deferredInstall = null;
let running = false;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function toHex(value) { const n = Number(value); return Number.isFinite(n) ? `0x${n.toString(16).toUpperCase().padStart(4, '0')}` : '—'; }
function ageLabel(value) {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return 'Unknown age';
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return 'Updated just now';
  if (min < 60) return `${min} min old`;
  const hours = Math.floor(min / 60);
  return hours < 24 ? `${hours} h old` : `${Math.floor(hours / 24)} d old`;
}
function toast(message) {
  const node = $('toast'); node.textContent = message; node.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add('hidden'), 2400);
}
function showError(message) { $('message').textContent = message; $('message').classList.remove('hidden'); }
function hideError() { $('message').classList.add('hidden'); }
function setLoading(value) {
  running = value;
  $('run').disabled = value;
  $('run').querySelector('span').textContent = value ? 'Extracting…' : 'Extract latest BRDC';
  $('valueSkeleton').classList.toggle('hidden', !value);
  $('values').classList.toggle('loading-values', value);
  $('nasaText').textContent = value ? 'Downloading BRDC…' : 'Ready on request';
}
function scheduleNext(from = Date.now()) { const next = from + REFRESH_MS; localStorage.setItem(NEXT_KEY, String(next)); return next; }
function nextRefreshTime() {
  let next = Number(localStorage.getItem(NEXT_KEY));
  if (!Number.isFinite(next) || next <= 0) next = scheduleNext();
  return next;
}
function updateCountdown() {
  const next = nextRefreshTime();
  let remaining = next - Date.now();
  if (remaining <= 0 && !running) { scheduleNext(); run(true); remaining = REFRESH_MS; }
  const total = Math.max(0, Math.floor(remaining / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  $('countdown').textContent = `${h}:${m}:${s}`;
}
function saveHistory(data) {
  const identity = `${data.updated_at}|${data.file_name}|${data.data1}|${data.data2}|${data.data3}|${data.data4}`;
  historyItems = historyItems.filter(item => item._identity !== identity);
  historyItems.unshift({ ...data, _identity: identity, saved_at: new Date().toISOString() });
  historyItems = historyItems.slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(historyItems));
  renderHistory();
}
function renderHistory() {
  const body = $('historyBody');
  $('historyCount').textContent = `${historyItems.length} result${historyItems.length === 1 ? '' : 's'}`;
  $('clearHistory').disabled = historyItems.length === 0;
  $('exportHistory').disabled = historyItems.length === 0;
  if (!historyItems.length) { body.innerHTML = '<tr class="empty"><td colspan="8">No extractions saved yet.</td></tr>'; return; }
  body.innerHTML = historyItems.map(item => `<tr><td>${escapeHtml(formatDate(item.updated_at || item.saved_at))}</td><td title="${escapeHtml(item.file_name)}">${escapeHtml(item.source_date || '—')}</td><td>${escapeHtml(item.data1)}</td><td>${escapeHtml(item.data2)}</td><td>${escapeHtml(item.data3)}</td><td>${escapeHtml(item.data4)}</td><td>${escapeHtml(item.tls)}</td><td><span class="table-status">${item.cached ? 'Cached' : 'Fresh'}</span></td></tr>`).join('');
}
function show(data, durationMs = null, persist = true) {
  current = data;
  ['data1','data2','data3','data4','tls'].forEach(key => $(key).textContent = data[key] ?? '—');
  ['data1','data2','data3','data4'].forEach((key, index) => $(`hex${index + 1}`).textContent = toHex(data[key]));
  $('sourceDate').textContent = data.source_date || '—';
  $('fileName').textContent = data.file_name || '—';
  $('updated').textContent = formatDate(data.updated_at);
  $('duration').textContent = durationMs == null ? (data.duration_ms ? `${data.duration_ms} ms` : 'Saved result') : `${durationMs} ms`;
  $('alpha').textContent = (data.alpha || []).join('  ·  ') || '—';
  $('beta').textContent = (data.beta || []).join('  ·  ') || '—';
  $('fresh').textContent = data.cached ? 'Cached' : 'Fresh';
  $('fresh').className = `pill ${data.cached ? 'cached' : 'online'}`;
  $('localText').textContent = 'Result available';
  $('sourceAge').textContent = ageLabel(data.updated_at);
  $('copyAll').disabled = false;
  if (persist) { localStorage.setItem(LAST_KEY, JSON.stringify(data)); saveHistory(data); }
}
async function health() {
  const start = performance.now();
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(); const ms = Math.round(performance.now() - start);
    $('health').textContent = `System online · ${ms} ms`; $('health').className = 'pill online';
    $('apiText').textContent = 'Online'; $('latency').textContent = `${ms} ms latency`; $('apiDot').className = 'dot';
    if (data.cache?.has_result && !current) $('localText').textContent = 'Server cache ready';
  } catch {
    $('health').textContent = 'System unavailable'; $('health').className = 'pill offline';
    $('apiText').textContent = 'Offline'; $('latency').textContent = 'Connection failed'; $('apiDot').className = 'dot offline-dot';
  }
}
async function run(automatic = false) {
  if (running) return;
  setLoading(true); hideError(); const start = performance.now();
  try {
    const response = await fetch('/api/calculate', { method: 'POST', headers: { Accept: 'application/json' } });
    let data = {}; try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    const duration = Math.round(performance.now() - start); data.duration_ms = duration;
    show(data, duration, true); scheduleNext();
    toast(automatic ? 'Automatic refresh completed' : 'Latest BRDC extracted');
  } catch (error) {
    showError(error.message || 'Extraction failed');
    toast('Extraction failed');
  } finally { setLoading(false); }
}
async function copyText(text, success) {
  try { await navigator.clipboard.writeText(text); toast(success); }
  catch { showError('Clipboard permission was not available.'); }
}
function exportHistory() {
  if (!historyItems.length) return;
  const headers = ['updated_at','source_date','file_name','data1','data2','data3','data4','tls','cached'];
  const rows = [headers.join(','), ...historyItems.map(item => headers.map(key => `"${String(item[key] ?? '').replace(/"/g, '""')}"`).join(','))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `haniaion-history-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
  toast('History exported');
}

$('run').addEventListener('click', () => run(false));
$('copyAll').addEventListener('click', () => current && copyText(`DATA1=${current.data1}\nDATA2=${current.data2}\nDATA3=${current.data3}\nDATA4=${current.data4}\nTLS=${current.tls}`, 'RAAM data copied'));
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.copy; if (current?.[key] !== undefined) copyText(String(current[key]), `${key.toUpperCase()} copied`); }));
$('clearHistory').addEventListener('click', () => { if (!confirm('Clear the local extraction history on this device?')) return; historyItems = []; localStorage.removeItem(HISTORY_KEY); renderHistory(); toast('Local history cleared'); });
$('exportHistory').addEventListener('click', exportHistory);
$('k69Frame').addEventListener('load', () => { $('k69Status').textContent = 'Connected'; $('k69Status').className = 'pill online'; });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; $('install').classList.remove('hidden'); });
$('install').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('install').classList.add('hidden'); });
window.addEventListener('appinstalled', () => toast('HaniaION installed'));

try { historyItems = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); if (!Array.isArray(historyItems)) historyItems = []; } catch { historyItems = []; }
renderHistory();
try { const saved = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); if (saved) show(saved, null, false); } catch {}
health(); updateCountdown(); setInterval(updateCountdown, 1000); setInterval(health, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/preview/service-worker.js').catch(() => {});
