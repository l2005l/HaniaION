// v3.7 — Field tools on the satellites page: where to stand (obstruction map from the phone's own
// signal by direction), when to measure (12-hour DOP forecast for GPS, Galileo, GLONASS, BeiDou)
// and point measurement (averaging with ITM coordinates and CSV/KML export).
(function (root) {
  "use strict";
  const rad = Math.PI / 180;

  /** WGS84 → ITM (EPSG:2039), using EPSG "Israel 1993 to WGS 84 (2)" (Helmert, 0.5 m) and TM on GRS80. */
  function toITM(lat, lon, h) {
    const sec = rad / 3600, W = { a: 6378137, f: 1 / 298.257223563 }, G = { a: 6378137, f: 1 / 298.257222101 };
    const ecef = (E, la, lo, hh) => { const e2 = E.f * (2 - E.f), s = Math.sin(la * rad), N = E.a / Math.sqrt(1 - e2 * s * s); return [(N + hh) * Math.cos(la * rad) * Math.cos(lo * rad), (N + hh) * Math.cos(la * rad) * Math.sin(lo * rad), (N * (1 - e2) + hh) * s]; };
    const geod = (E, x, y, z) => { const e2 = E.f * (2 - E.f), lo = Math.atan2(y, x), p = Math.hypot(x, y); let la = Math.atan2(z, p * (1 - e2)); for (let i = 0; i < 6; i++) { const s = Math.sin(la), N = E.a / Math.sqrt(1 - e2 * s * s); la = Math.atan2(z + e2 * N * s, p); } return [la / rad, lo / rad]; };
    const T = [23.772, 17.49, 17.859], rx = 0.3132 * sec, ry = 1.85274 * sec, rz = -1.67299 * sec, s = -5.4262e-6;
    const [xw, yw, zw] = ecef(W, lat, lon, h || 0);
    const d = [xw - T[0], yw - T[1], zw - T[2]].map((v) => v / (1 + s));
    const [la, lo] = geod(G, d[0] - rz * d[1] + ry * d[2], rz * d[0] + d[1] - rx * d[2], -ry * d[0] + rx * d[1] + d[2]);
    const a = G.a, e2 = G.f * (2 - G.f), ep2 = e2 / (1 - e2), k0 = 1.0000067, lat0 = 31.7343936111111 * rad, lon0 = 35.2045169444444 * rad;
    const M = (p) => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p) + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
    const p = la * rad, N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2), t = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, A = (lo * rad - lon0) * Math.cos(p);
    return {
      e: 219529.584 + k0 * N * (A + (1 - t + C) * A ** 3 / 6 + (5 - 18 * t + t * t + 72 * C - 58 * ep2) * A ** 5 / 120),
      n: 626907.39 + k0 * (M(p) - M(lat0) + N * Math.tan(p) * (A * A / 2 + (5 - t + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * t + t * t + 600 * C - 330 * ep2) * A ** 6 / 720)),
    };
  }

  const SECTORS = ["צפון", "צפון־מזרח", "מזרח", "דרום־מזרח", "דרום", "דרום־מערב", "מערב", "צפון־מערב"];
  const AWAY = ["דרומה", "דרום־מערבה", "מערבה", "צפון־מערבה", "צפונה", "צפון־מזרחה", "מזרחה", "דרום־מזרחה"];
  /**
   * Which directions are blocked: the phone's own signal by direction, and (when known) GPS satellites
   * that should be up in a direction but are not heard there at all.
   */
  function sky(snap, expected) {
    const sats = (snap && Array.isArray(snap.satellites) ? snap.satellites : []).filter((s) => s.elevation > 5);
    const out = SECTORS.map((name, i) => ({ i, name, n: 0, used: 0, cn0: [], expected: 0, heard: 0 }));
    const sec = (az) => Math.floor((((az % 360) + 360 + 22.5) % 360) / 45);
    for (const s of sats) { const o = out[sec(s.azimuth)]; o.n++; if (s.used) o.used++; if (s.cn0 > 0) o.cn0.push(s.cn0); }
    if (expected && Array.isArray(expected.gps)) {
      const heard = new Set(sats.filter((s) => s.constellation === "GPS" && s.cn0 > 0).map((s) => s.svid));
      for (const g of expected.gps) if (g.elevation >= 15) { const o = out[sec(g.azimuth)]; o.expected++; if (heard.has(g.prn)) o.heard++; }
    }
    for (const o of out) {
      o.avg = o.cn0.length ? o.cn0.reduce((a, b) => a + b, 0) / o.cn0.length : null;
      o.state = o.n === 0 && o.expected === 0 ? "empty" : (o.expected >= 2 && o.heard === 0) || (o.avg != null && o.avg < 22) || (o.n > 0 && o.avg == null) ? "blocked" : o.avg != null && o.avg < 30 ? "partial" : o.avg != null ? "open" : "empty";
    }
    const all = sats.filter((s) => s.cn0 > 0).map((s) => s.cn0), mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
    const blocked = out.filter((o) => o.state === "blocked"), open = out.filter((o) => o.state === "open");
    let title, text;
    if (!sats.length) { title = "ממתין ללוויינים"; text = "מחפש לוויינים. בשטח פתוח זה לוקח כמה שניות."; }
    else if (mean != null && mean < 22 && open.length === 0) { title = "נראה שאתה בתוך מבנה"; text = "האות חלש מכל הכיוונים (" + mean.toFixed(0) + " dB-Hz). למדידה צריך לצאת החוצה, רחוק מקירות."; }
    else if (!blocked.length) { title = "השמיים פתוחים"; text = "אין חסימה בולטת באף כיוון. זה מקום טוב למדידה."; }
    else {
      const worst = blocked.slice().sort((a, b) => (a.avg || 0) - (b.avg || 0))[0];
      title = "חסימה ב" + blocked.map((o) => o.name).join(", ");
      text = "באות מ" + worst.name + " חלש" + (worst.expected >= 2 && worst.heard === 0 ? ", ולווייני GPS שאמורים להיות שם לא נשמעים בכלל" : "") + ". כנראה בניין, עצים או מצוק. כדאי לזוז כמה מטרים " + AWAY[worst.i] + ", הרחק מהמכשול.";
    }
    return { sectors: out, title, text, mean, used: sats.filter((s) => s.used).length, visible: sats.length, blocked: blocked.length };
  }

  /** Weighted average of fixes (1/accuracy²) and how spread they are. */
  function average(fixes) {
    if (!fixes.length) return null;
    let w = 0, la = 0, lo = 0, h = 0, hw = 0;
    for (const f of fixes) { const k = 1 / Math.max(1, f.acc || 10) ** 2; w += k; la += f.lat * k; lo += f.lon * k; if (f.alt != null) { h += f.alt * k; hw += k; } }
    la /= w; lo /= w;
    const mLat = 111320, mLon = 111320 * Math.cos(la * rad);
    const d = fixes.map((f) => Math.hypot((f.lat - la) * mLat, (f.lon - lo) * mLon));
    const rms = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    const accs = fixes.map((f) => f.acc).filter((x) => x > 0).sort((a, b) => a - b);
    return { lat: la, lon: lo, alt: hw ? h / hw : null, spread: rms, acc: accs.length ? accs[Math.floor(accs.length / 2)] : null, n: fixes.length };
  }

  root.HaniaField = { toITM, sky, average };
  if (typeof document === "undefined") return;

  // ---- Page ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  if (!$("wherePanel")) return;
  const native = () => root.HaniaAndroid && typeof root.HaniaAndroid.getGnssSnapshot === "function";
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  try {
    const v = JSON.parse(localStorage.getItem("haniaion-interference-session") || "null");
    if (v && Date.now() - v.startedAt < (v.mode === "watch" ? 30 : 10) * 60 * 1000) {
      const back = el("a", "fw-running", v.mode === "watch" ? "🛰️ מעקב שיבוש רץ ברקע · לחזור לתוצאה" : "🛰️ בדיקת שיבוש רצה ברקע · לחזור לתוצאה");
      back.href = "/#gnss-monitor";
      const tabs = document.querySelector(".tabs"); if (tabs) tabs.before(back);
    }
  } catch {}
  const KEY = "haniaion-points";
  const store = { get(d) { try { return JSON.parse(localStorage.getItem(KEY) || "null") || d; } catch { return d; } }, set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} } };
  const fmt = (n, d) => n.toLocaleString("he-IL", { minimumFractionDigits: d, maximumFractionDigits: d });
  let snap = {}, expected = null, expectedAt = 0, timer = null, users = 0;
  const here = () => (snap.network || snap.location ? snap.network || snap.location : null);

  function startReceiver() {
    users++;
    if (!native() || timer) return true;
    const r = root.HaniaAndroid.startGnssMonitor();
    if (r === "location-permission-required") return false;
    timer = setInterval(poll, 1000); poll();
    return true;
  }
  function stopReceiver() { users = Math.max(0, users - 1); if (!users && timer) { clearInterval(timer); timer = null; } }
  function poll() {
    try { snap = JSON.parse(root.HaniaAndroid.getGnssSnapshot() || "{}"); } catch { return; }
    const p = here();
    if (p && Date.now() - expectedAt > 60000) { expectedAt = Date.now(); fetch("/api/gnss/expected?lat=" + p.lat.toFixed(3) + "&lon=" + p.lon.toFixed(3)).then((r) => r.json()).then((d) => { if (d.available) expected = d; }).catch(() => {}); }
    if (whereOn) renderWhere();
    if (measuring) onFix();
  }

  // ---- Where to stand ------------------------------------------------------------------
  let whereOn = false;
  function renderWhere() {
    const r = sky(snap, expected);
    const card = $("whereStatus"); card.dataset.state = r.blocked ? "warn" : r.title === "השמיים פתוחים" ? "ok" : "wait";
    $("whereTitle").textContent = r.title; $("whereText").textContent = r.text;
    $("whereMeta").textContent = r.used + " מתוך " + r.visible + " לוויינים בשימוש" + (r.mean != null ? " · עוצמת אות ממוצעת " + r.mean.toFixed(0) + " dB-Hz" : "");
    drawSky(r);
    const list = $("whereSectors"); list.textContent = "";
    for (const o of r.sectors) { const li = el("li", o.state); li.append(el("b", "", o.name), el("span", "", o.state === "empty" ? "אין לוויינים בכיוון" : o.state === "blocked" ? "חסום" : o.state === "partial" ? "חלקי" : "פתוח"), el("small", "", (o.avg != null ? o.avg.toFixed(0) + " dB-Hz · " : "") + o.n + " לוויינים")); list.append(li); }
  }
  function drawSky(r) {
    const c = $("whereSky"), dpr = root.devicePixelRatio || 1, size = c.clientWidth || 300;
    c.width = size * dpr; c.height = size * dpr;
    const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2, R = size / 2 - 22, fill = { open: "rgba(70,240,165,.20)", partial: "rgba(255,209,102,.24)", blocked: "rgba(255,107,125,.34)", empty: "rgba(145,168,189,.06)" };
    for (const o of r.sectors) { const a0 = (-90 + o.i * 45 - 22.5) * rad, a1 = a0 + 45 * rad; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fillStyle = fill[o.state]; g.fill(); }
    g.strokeStyle = "rgba(125,176,226,.28)"; g.lineWidth = 1;
    for (const k of [1, 2 / 3, 1 / 3]) { g.beginPath(); g.arc(cx, cy, R * k, 0, 2 * Math.PI); g.stroke(); }
    g.fillStyle = "#91a8bd"; g.font = "600 12px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    [["צ", 0], ["מז", 90], ["ד", 180], ["מע", 270]].forEach(([t, az]) => g.fillText(t, cx + (R + 12) * Math.sin(az * rad), cy - (R + 12) * Math.cos(az * rad)));
    for (const s of (snap.satellites || []).filter((x) => x.elevation > 0)) {
      const d = R * (1 - s.elevation / 90), x = cx + d * Math.sin(s.azimuth * rad), y = cy - d * Math.cos(s.azimuth * rad);
      g.beginPath(); g.arc(x, y, s.used ? 5 : 3.5, 0, 2 * Math.PI); g.fillStyle = !(s.cn0 > 0) ? "#52677d" : s.cn0 >= 30 ? "#46f0a5" : s.cn0 >= 22 ? "#ffd166" : "#ff6b7d"; g.fill();
    }
  }
  $("whereStart").addEventListener("click", () => {
    if (!native()) return;
    if (whereOn) { whereOn = false; stopReceiver(); $("whereStart").textContent = "להתחיל"; return; }
    if (!startReceiver()) { $("whereTitle").textContent = "נדרשת הרשאת מיקום מדויק"; return; }
    whereOn = true; $("whereStart").textContent = "לעצור";
  });

  // ---- When to measure -----------------------------------------------------------------
  async function locate() {
    const p = here(); if (p) return { lat: p.lat, lon: p.lon, how: "המיקום שלך" };
    try { const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { maximumAge: 600000, timeout: 8000 })); return { lat: pos.coords.latitude, lon: pos.coords.longitude, how: "המיקום שלך" }; }
    catch { return { lat: 31.77, lon: 35.21, how: "מרכז הארץ (אין הרשאת מיקום)" }; }
  }
  const hm = (iso) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  async function loadWhen() {
    $("whenTitle").textContent = "מחשב תחזית…";
    const at = await locate(), mask = $("whenMask").value;
    try {
      const r = await fetch("/api/gnss/forecast?lat=" + at.lat.toFixed(3) + "&lon=" + at.lon.toFixed(3) + "&hours=12&mask=" + mask, { cache: "no-store" }), d = await r.json();
      if (!d.available || !d.steps.length) { $("whenTitle").textContent = "התחזית לא זמינה כרגע"; $("whenText").textContent = "לא הצלחנו לטעון את מסלולי הלוויינים. נסו שוב בעוד כמה דקות."; return; }
      $("whenTitle").textContent = d.best ? "החלון הכי טוב: " + "\u2066" + hm(d.best.from) + "–" + hm(d.best.to) + "\u2069" : "אין היום חלון מצוין ב־12 השעות הקרובות";
      $("whenText").textContent = (d.best ? "PDOP ממוצע " + d.best.mean_pdop + ", הרבה לוויינים ופיזור טוב בשמיים. " : "") + (d.avoid.length ? "כדאי להימנע מ: " + d.avoid.map((w) => "\u2066" + hm(w.from) + "–" + hm(w.to) + "\u2069").join(", ") + "." : "אין חלונות גרועים.");
      $("whenMeta").textContent = at.how + " · זווית מינימום " + mask + "° · " + Object.entries(d.systems).filter(([, n]) => n).map(([k, n]) => k + " " + n).join(" · ") + (d.kp_available ? " · כולל תחזית Kp" : "");
      drawWhen(d);
    } catch { $("whenTitle").textContent = "התחזית לא זמינה כרגע"; }
  }
  function drawWhen(d) {
    const svg = $("whenChart"), W = 360, H = 200, L = 30, Rm = 30, T = 14, B = 26, n = d.steps.length;
    const maxC = Math.max(12, ...d.steps.map((s) => s.count)), maxP = 6;
    const x = (i) => L + (i / (n - 1)) * (W - L - Rm), yC = (c) => H - B - (c / maxC) * (H - T - B), yP = (p) => T + (Math.min(p, maxP) / maxP) * (H - T - B);
    let s = '<rect x="' + L + '" y="' + T + '" width="' + (W - L - Rm) + '" height="' + (H - T - B) + '" fill="none" stroke="rgba(125,176,226,.18)"/>';
    if (d.best) { const i0 = d.steps.findIndex((t) => t.time === d.best.from), i1 = d.steps.findIndex((t) => t.time === d.best.to); s += '<rect x="' + x(i0) + '" y="' + T + '" width="' + Math.max(2, x(i1) - x(i0)) + '" height="' + (H - T - B) + '" fill="rgba(70,240,165,.14)"/>'; }
    for (const w of d.avoid) { const i0 = d.steps.findIndex((t) => t.time === w.from), i1 = d.steps.findIndex((t) => t.time === w.to); s += '<rect x="' + x(i0) + '" y="' + T + '" width="' + Math.max(2, x(i1) - x(i0)) + '" height="' + (H - T - B) + '" fill="rgba(255,107,125,.14)"/>'; }
    s += '<path d="M' + d.steps.map((t, i) => x(i).toFixed(1) + " " + yC(t.count).toFixed(1)).join(" L") + " L" + x(n - 1) + " " + (H - B) + " L" + L + " " + (H - B) + 'Z" fill="rgba(67,217,255,.16)"/>';
    s += '<path d="M' + d.steps.map((t, i) => x(i).toFixed(1) + " " + yC(t.count).toFixed(1)).join(" L") + '" fill="none" stroke="#43d9ff" stroke-width="1.6"/>';
    for (const lim of [2, 4]) s += '<line x1="' + L + '" x2="' + (W - Rm) + '" y1="' + yP(lim) + '" y2="' + yP(lim) + '" stroke="rgba(255,209,102,.35)" stroke-dasharray="3 4"/><text x="' + (W - Rm + 4) + '" y="' + (yP(lim) + 4) + '" fill="#ffd166" font-size="10">' + lim + "</text>";
    const pts = d.steps.map((t, i) => (t.pdop != null ? x(i).toFixed(1) + " " + yP(t.pdop).toFixed(1) : null)).filter(Boolean);
    if (pts.length) s += '<path d="M' + pts.join(" L") + '" fill="none" stroke="#ffd166" stroke-width="2"/>';
    for (let i = 0; i < n; i += 12) s += '<text x="' + x(i) + '" y="' + (H - 8) + '" fill="#91a8bd" font-size="10" text-anchor="middle">' + hm(d.steps[i].time) + "</text>";
    s += '<text x="' + (L - 4) + '" y="' + (yC(maxC) + 4) + '" fill="#43d9ff" font-size="10" text-anchor="end">' + maxC + '</text><text x="' + (L - 4) + '" y="' + (H - B) + '" fill="#43d9ff" font-size="10" text-anchor="end">0</text>';
    svg.innerHTML = s;
  }
  $("whenMask").addEventListener("change", loadWhen);
  $("whenRefresh").addEventListener("click", loadWhen);

  // ---- Point measurement ---------------------------------------------------------------
  let measuring = false, fixes = [], t0 = 0, dur = 60, watchId = null, ifHist = [], ifResults = [];
  function onFix(webPos) {
    const now = Date.now();
    let f = null;
    if (webPos) f = { lat: webPos.coords.latitude, lon: webPos.coords.longitude, acc: webPos.coords.accuracy, alt: webPos.coords.altitude, t: now };
    else if (snap.location && snap.location.time && (!fixes.length || snap.location.time !== fixes[fixes.length - 1].t)) f = { lat: snap.location.lat, lon: snap.location.lon, acc: snap.location.accuracy, alt: null, t: snap.location.time };
    if (!webPos && root.HaniaInterference) { root.HaniaInterference.remember(ifHist, snap, now); ifResults.push(root.HaniaInterference.analyze(snap, ifHist, { expected, now })); }
    if (f && f.acc && f.acc < 100) fixes.push(f);
    const left = Math.max(0, dur - Math.round((now - t0) / 1000)), a = average(fixes);
    $("pointBar").style.width = Math.min(100, ((now - t0) / (dur * 1000)) * 100) + "%";
    $("pointTitle").textContent = "מודד… עוד " + left + " שניות";
    $("pointLive").textContent = a ? fixes.length + " מדידות · דיוק " + fmt(a.acc || 0, 1) + " מ׳ · פיזור " + fmt(a.spread, 2) + " מ׳" : "ממתין למיקום מהלוויינים…";
    if (left <= 0) finishPoint();
  }
  function startPoint() {
    if (measuring) { finishPoint(true); return; }
    dur = Number($("pointDur").value); fixes = []; ifHist = []; ifResults = []; t0 = Date.now(); measuring = true;
    $("pointStart").textContent = "לעצור"; $("pointProgress").hidden = false; $("pointResult").hidden = true;
    if (native()) { if (!startReceiver()) { measuring = false; $("pointTitle").textContent = "נדרשת הרשאת מיקום מדויק"; return; } }
    else if (navigator.geolocation) { watchId = navigator.geolocation.watchPosition(onFix, () => { $("pointTitle").textContent = "אין הרשאת מיקום"; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }); const tick = setInterval(() => { if (!measuring) return clearInterval(tick); onFix(null); }, 1000); }
  }
  function finishPoint(stopped) {
    measuring = false; $("pointStart").textContent = "להתחיל מדידה"; $("pointProgress").hidden = true;
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (native()) stopReceiver();
    const a = average(fixes);
    if (!a || a.n < 3) { $("pointTitle").textContent = stopped ? "המדידה נעצרה" : "לא התקבלו מספיק מדידות"; $("pointLive").textContent = "כדאי לנסות שוב במקום פתוח."; return; }
    const v = ifResults.length && root.HaniaInterference ? root.HaniaInterference.verdict(ifResults) : null;
    const itm = toITM(a.lat, a.lon, a.alt || 0);
    const name = $("pointName").value.trim() || "נקודה " + (store.get([]).length + 1);
    const pt = { name, t: new Date().toISOString(), lat: +a.lat.toFixed(7), lon: +a.lon.toFixed(7), alt: a.alt != null ? +a.alt.toFixed(1) : null, e: +itm.e.toFixed(2), n: +itm.n.toFixed(2), acc: a.acc != null ? +a.acc.toFixed(1) : null, spread: +a.spread.toFixed(2), samples: a.n, seconds: Math.round((Date.now() - t0) / 1000), check: v ? (v.kind ? v.title : v.level === "weak" ? "קליטה חלשה" : "תקין") : "לא נבדק (דפדפן)" };
    const list = store.get([]); list.unshift(pt); store.set(list.slice(0, 500));
    $("pointTitle").textContent = "נמדד: " + name;
    $("pointLive").textContent = "";
    $("pointResult").hidden = false;
    $("pointITM").textContent = "E " + fmt(pt.e, 2) + " · N " + fmt(pt.n, 2);
    $("pointWGS").textContent = pt.lat.toFixed(7) + ", " + pt.lon.toFixed(7) + (pt.alt != null ? " · גובה " + pt.alt + " מ׳" : "");
    $("pointQuality").textContent = pt.samples + " מדידות ב־" + pt.seconds + " שניות · דיוק " + (pt.acc ?? "—") + " מ׳ · פיזור " + pt.spread + " מ׳ · שיבוש/הטעיה: " + pt.check;
    $("pointName").value = ""; renderPoints();
  }
  function renderPoints() {
    const list = store.get([]), box = $("pointList"); box.textContent = "";
    $("pointCount").textContent = list.length ? list.length + " נקודות" : "";
    if (!list.length) { box.append(el("p", "muted", "עוד אין נקודות. כל מדידה נשמרת כאן, בטלפון.")); return; }
    list.slice(0, 50).forEach((p, i) => {
      const row = el("div", "pt-row" + (/הטעיה|שיבוש/.test(p.check) ? " warn" : ""));
      row.append(el("b", "", p.name), el("span", "num", "E " + fmt(p.e, 2) + " · N " + fmt(p.n, 2)), el("small", "", new Date(p.t).toLocaleString("he-IL") + " · ±" + (p.acc ?? "—") + " מ׳ · " + p.check));
      const del = el("button", "pt-del", "×"); del.type = "button"; del.setAttribute("aria-label", "מחיקת " + p.name);
      del.addEventListener("click", () => { const l = store.get([]); l.splice(i, 1); store.set(l); renderPoints(); });
      row.append(del); box.append(row);
    });
  }
  const csv = () => ["name,time,itm_e,itm_n,lat,lon,alt_m,accuracy_m,spread_m,samples,check"].concat(store.get([]).map((p) => ['"' + p.name.replace(/"/g, '""') + '"', p.t, p.e, p.n, p.lat, p.lon, p.alt ?? "", p.acc ?? "", p.spread, p.samples, '"' + p.check + '"'].join(","))).join("\n");
  const kml = () => '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>HaniaION</name>' + store.get([]).map((p) => "<Placemark><name>" + p.name.replace(/[<&]/g, "") + "</name><description>ITM E " + p.e + " N " + p.n + " · ±" + (p.acc ?? "") + " m · " + p.check + "</description><Point><coordinates>" + p.lon + "," + p.lat + "," + (p.alt ?? 0) + "</coordinates></Point></Placemark>").join("") + "</Document></kml>";
  const download = (text, type, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); };
  $("pointStart").addEventListener("click", startPoint);
  $("pointCsv").addEventListener("click", () => download("﻿" + csv(), "text/csv", "haniaion-points.csv"));
  $("pointKml").addEventListener("click", () => download(kml(), "application/vnd.google-earth.kml+xml", "haniaion-points.kml"));
  $("pointCopy").addEventListener("click", () => { (navigator.clipboard ? navigator.clipboard.writeText(csv()) : Promise.reject()).then(() => { $("pointCopy").textContent = "הועתק"; setTimeout(() => { $("pointCopy").textContent = "העתקה"; }, 1600); }, () => {}); });

  if (!native()) { $("whereWeb").hidden = false; $("whereStart").hidden = true; $("pointWeb").hidden = false; }
  renderPoints();
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab === "when" && !$("whenChart").innerHTML) loadWhen(); }));
  if (document.querySelector('.tab.active[data-tab="when"]')) loadWhen();
})(typeof window !== "undefined" ? window : globalThis);
