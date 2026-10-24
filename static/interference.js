// v3.6 — Jamming and spoofing monitor.
// Independent signals, each with its reason in plain Hebrew:
//   spoofing: satellite fix far from the network fix, "landing" at a known spoofing spot,
//             signal strength too even across satellites, strong low satellites, satellites
//             where the real sky has none, other constellations vanishing, a mock-location app,
//             satellite time far from the phone, impossible jumps;
//   jamming:  all signals dropping together, receiver gain (AGC) dropping, satellites in view
//             but no fix — weighed against geomagnetic storms (NOAA Kp).
// Runs inside the HaniaION Android app (window.HaniaAndroid); on the web it shows space weather
// and the community map only.
(function (root) {
  "use strict";

  const LANDINGS = [
    { name: "נמל התעופה של ביירות", lat: 33.8209, lon: 35.4884 },
    { name: "נמל התעופה של קהיר", lat: 30.1219, lon: 31.4056 },
    { name: "נמל התעופה של עמאן", lat: 31.7226, lon: 35.9932 },
    { name: "נמל התעופה של דמשק", lat: 33.4114, lon: 36.5156 },
  ];
  const PLACES = [
    ["ירושלים", 31.7683, 35.2137], ["תל אביב", 32.0853, 34.7818], ["חיפה", 32.794, 34.9896], ["באר שבע", 31.252, 34.7915], ["אשדוד", 31.8014, 34.6435],
    ["נתניה", 32.3215, 34.8532], ["אשקלון", 31.6688, 34.5743], ["חדרה", 32.434, 34.9196], ["נהריה", 33.0058, 35.0941], ["כרמיאל", 32.919, 35.295],
    ["עפולה", 32.608, 35.289], ["טבריה", 32.7959, 35.53], ["צפת", 32.9646, 35.496], ["קריית שמונה", 33.2073, 35.57], ["בית שאן", 32.4973, 35.4986],
    ["מודיעין", 31.898, 35.0104], ["רחובות", 31.8928, 34.8113], ["כפר סבא", 32.175, 34.9069], ["אריאל", 32.1056, 35.173], ["דימונה", 31.07, 35.033],
    ["אילת", 29.5577, 34.9519], ["שדרות", 31.525, 34.5969], ["קצרין", 32.9925, 35.6919], ["עכו", 32.9281, 35.0818], ["יקנעם", 32.6596, 35.1044],
  ];

  const km = (a, b, c, d) => { const R = 6371, r = (x) => (x * Math.PI) / 180, dLa = r(c - a), dLo = r(d - b); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const pearson = (xs, ys) => { const mx = mean(xs), my = mean(ys); let n = 0, a = 0, b = 0; for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); a += (xs[i] - mx) ** 2; b += (ys[i] - my) ** 2; } return a && b ? n / Math.sqrt(a * b) : 0; };
  const fmtKm = (d) => (d >= 10 ? Math.round(d) : d.toFixed(1)) + " ק״מ";
  const placeName = (lat, lon) => { let best = null; for (const [n, a, b] of PLACES) { const d = km(lat, lon, a, b); if (!best || d < best.d) best = { n, d }; } return best && best.d <= 30 ? "אזור " + best.n : lat.toFixed(1) + ", " + lon.toFixed(1); };

  /** Keep the last 15 minutes of what the receiver said, for the baselines. */
  function remember(hist, snap, now) {
    const sats = Array.isArray(snap.satellites) ? snap.satellites : [];
    const live = sats.filter((s) => s.cn0 > 0);
    const nonGps = sats.filter((s) => ["Galileo", "GLONASS", "BeiDou"].includes(s.constellation)).length;
    const agc = {};
    for (const a of snap.agc || []) agc[a.constellation + " " + a.frequency_mhz] = a.db;
    hist.push({ t: now, cn0: live.length ? mean(live.map((s) => s.cn0)) : null, visible: sats.length, used: sats.filter((s) => s.used).length, nonGps, agc, loc: snap.location || null });
    while (hist.length && now - hist[0].t > 15 * 60 * 1000) hist.shift();
    return hist;
  }

  /**
   * Everything we can tell from one snapshot plus the recent history.
   * ctx: { expected: {gps:[{prn,elevation}], computed_at}, kp: number|null, now }
   */
  function analyze(snap, hist, ctx) {
    ctx = ctx || {};
    const now = ctx.now || Date.now();
    const reasons = [], add = (kind, pts, text, sev) => { reasons.push({ kind, pts, text, sev: sev || (pts >= 40 ? "high" : pts >= 20 ? "mid" : "low") }); };
    const sats = Array.isArray(snap && snap.satellites) ? snap.satellites : [];
    const used = sats.filter((s) => s.used), loc = snap && snap.location, net = snap && snap.network;
    const visible = sats.length;
    const byCon = {}; for (const s of sats) byCon[s.constellation] = (byCon[s.constellation] || 0) + 1;

    // --- Spoofing ---------------------------------------------------------------
    if (loc && loc.mock) add("spoof", 60, "במכשיר פעילה אפליקציה שמזייפת מיקום (מיקום מדומה). המיקום לא מגיע מהלוויינים.");
    let netDist = null;
    if (loc && net && (net.age_ms == null || net.age_ms < 5 * 60 * 1000) && (net.accuracy == null || net.accuracy < 5000)) {
      netDist = km(loc.lat, loc.lon, net.lat, net.lon);
      const allow = Math.max(3, (((net.accuracy || 1500) + (loc.accuracy || 20)) / 1000) * 3);
      if (netDist > allow) add("spoof", netDist > 50 ? 65 : netDist > 10 ? 45 : 30, "המיקום מהלוויינים רחוק " + fmtKm(netDist) + " מהמיקום לפי הרשת הסלולרית וה־WiFi.");
    }
    if (loc) for (const L of LANDINGS) {
      const d = km(loc.lat, loc.lon, L.lat, L.lon);
      if (d <= 15 && (netDist == null || netDist > 30)) { add("spoof", netDist == null ? 35 : 20, "המיקום \"נחת\" ב" + L.name + ", נקודה מוכרת של הטעיות GPS באזור."); break; }
    }
    const strong = used.filter((s) => s.cn0 > 0);
    if (strong.length >= 6) {
      const c = strong.map((s) => s.cn0), spread = sd(c), m = mean(c);
      if (spread < 1.8 && m >= 38) add("spoof", 25, "עוצמת האות כמעט זהה בכל הלוויינים (הפרש של " + spread.toFixed(1) + " dB בלבד). אות אמיתי משתנה לפי גובה הלוויין, כאן נראה כאילו כולם מגיעים ממשדר אחד.");
      if (strong.length >= 8) {
        const r = pearson(strong.map((s) => s.elevation), c);
        if (r < -0.15) add("spoof", 15, "לוויינים נמוכים באופק חזקים יותר מלוויינים גבוהים. בשמיים אמיתיים זה הפוך.");
      }
    }
    if (ctx.expected && Array.isArray(ctx.expected.gps) && ctx.expected.gps.length) {
      const exp = new Map(ctx.expected.gps.map((g) => [g.prn, g]));
      let below = 0, off = 0, example = null;
      for (const s of used.filter((x) => x.constellation === "GPS" && x.elevation > 10)) {
        const e = exp.get(s.svid);
        if (!e) continue;
        if (e.elevation < -3) { below++; if (!example) example = s.svid; }
        else if (Math.abs(e.elevation - s.elevation) > 15) off++;
      }
      if (below >= 2 || below + off >= 4) add("spoof", 35, (below + off) + " לווייני GPS נראים במקום שבו הם לא נמצאים עכשיו" + (example ? " (למשל PRN " + example + ", שאמור להיות מתחת לאופק)" : "") + ".");
    }
    const past = hist.filter((h) => now - h.t > 60 * 1000 && now - h.t < 10 * 60 * 1000);
    const nonGpsNow = (byCon.Galileo || 0) + (byCon.GLONASS || 0) + (byCon.BeiDou || 0);
    if (past.length && Math.max(...past.map((h) => h.nonGps)) >= 4 && nonGpsNow === 0 && used.filter((s) => s.constellation === "GPS").length >= 4)
      add("spoof", 20, "Galileo, GLONASS ו־BeiDou נעלמו פתאום, ורק GPS נשאר. משדרי הטעיה משדרים בדרך כלל רק GPS.");
    if (snap && typeof snap.time_offset_ms === "number" && Math.abs(snap.time_offset_ms) > 10000)
      add("spoof", 15, "השעה מהלוויינים רחוקה " + Math.round(Math.abs(snap.time_offset_ms) / 1000) + " שניות משעון הטלפון.");
    const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
    if (loc && prev && prev.loc && loc.time && prev.loc.time && loc.time > prev.loc.time) {
      const dt = (loc.time - prev.loc.time) / 1000, d = km(prev.loc.lat, prev.loc.lon, loc.lat, loc.lon) * 1000;
      if (dt > 0.2 && dt < 15 && d > 150 && d / dt > 120) add("spoof", 30, "המיקום קפץ " + (d >= 1000 ? fmtKm(d / 1000) : Math.round(d) + " מ׳") + " תוך " + Math.round(dt) + " שניות, מהר יותר ממטוס.");
    }

    // --- Jamming ----------------------------------------------------------------
    const cn0Now = (() => { const l = sats.filter((s) => s.cn0 > 0); return l.length ? mean(l.map((s) => s.cn0)) : null; })();
    const base = past.filter((h) => h.cn0 != null);
    const baseCn0 = base.length >= 5 ? median(base.map((h) => h.cn0)) : null;
    if (baseCn0 != null && baseCn0 >= 25 && cn0Now != null && cn0Now < baseCn0 - 8)
      add("jam", 35, "עוצמת האות של כל הלוויינים ירדה ב־" + Math.round(baseCn0 - cn0Now) + " dB בבת אחת.");
    const agcNow = {}; for (const a of (snap && snap.agc) || []) agcNow[a.constellation + " " + a.frequency_mhz] = a.db;
    for (const [k, v] of Object.entries(agcNow)) {
      const b = past.map((h) => h.agc && h.agc[k]).filter((x) => typeof x === "number");
      if (b.length >= 5) { const m = median(b); if (v < m - 5) { add("jam", 40, "רמת ההגבר במקלט (" + k.split(" ")[0] + ") ירדה ב־" + Math.round(m - v) + " dB. זה סימן לרעש חזק בתדר הלוויינים."); break; } }
    }
    if (visible >= 8 && used.length === 0) {
      const since = hist.slice().reverse().findIndex((h) => h.used > 0);
      const blind = since === -1 ? (hist.length ? (now - hist[0].t) / 1000 : 0) : (now - hist[hist.length - 1 - since].t) / 1000;
      if (blind >= 20) add("jam", 25, "רואים " + visible + " לוויינים, אבל כבר " + Math.round(blind) + " שניות אי אפשר לקבוע מיקום.");
    }
    if (cn0Now != null && cn0Now < 20 && visible >= 6) add("jam", 10, "האות מכל הלוויינים חלש מאוד (" + cn0Now.toFixed(0) + " dB-Hz בממוצע).", "low");

    let spoof = Math.min(100, reasons.filter((r) => r.kind === "spoof").reduce((s, r) => s + r.pts, 0));
    let jam = Math.min(100, reasons.filter((r) => r.kind === "jam").reduce((s, r) => s + r.pts, 0));
    const kp = typeof ctx.kp === "number" ? ctx.kp : null;
    if (kp != null && kp >= 5 && jam > 0) { jam = Math.round(jam * 0.6); reasons.push({ kind: "space", pts: 0, sev: "info", text: "Kp " + kp + ": יש עכשיו סערה גיאומגנטית. חלק מהירידה בקליטה עשוי לנבוע ממזג אוויר בחלל ולא משיבוש." }); }

    let level = "ok", title = "לא זוהו שיבוש או הטעיה", kind = null;
    if (!visible && !loc) { level = "wait"; title = "ממתין לנתונים מהמקלט"; }
    else if (spoof >= 60) { level = "high"; kind = "spoof"; title = "הטעיית מיקום, כמעט בוודאות"; }
    else if (jam >= 50) { level = "high"; kind = "jam"; title = "חשד חזק לשיבוש GPS"; }
    else if (spoof >= 35) { level = "warn"; kind = "spoof"; title = "חשד להטעיית מיקום"; }
    else if (jam >= 30) { level = "warn"; kind = "jam"; title = "חשד לשיבוש GPS"; }
    else if (used.length < 4) { level = "weak"; title = "אין מספיק לוויינים לקביעת מיקום"; }
    return { level, kind, title, spoof, jam, reasons, netDistKm: netDist, visible, used: used.length, cn0: cn0Now, byCon, kp };
  }

  root.HaniaInterference = { analyze, remember, km, placeName, LANDINGS };
  if (typeof document === "undefined") return;

  // ---- Runtime in the page ------------------------------------------------------
  const KEY = "haniaion-interference";
  const $ = (id) => document.getElementById(id);
  const card = $("interference");
  if (!card) return;
  const native = () => root.HaniaAndroid && typeof root.HaniaAndroid.getGnssSnapshot === "function";
  const store = { get(k, d) { try { const v = localStorage.getItem(KEY + "-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(KEY + "-" + k, JSON.stringify(v)); } catch {} } };
  const hist = [];
  let expected = null, kp = null, timer = null, lastExpectedAt = 0, lastLogged = {};
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function loadKp() {
    try { const r = await fetch("/api/spaceweather", { cache: "no-store" }); const d = await r.json(); if (d.available) { kp = d.kp; $("ifKp").textContent = "Kp " + d.kp + (d.level === "storm" ? " · סערה גיאומגנטית" : d.level === "active" ? " · פעילות מוגברת" : " · שקט"); $("ifKp").dataset.level = d.level; } else $("ifKp").textContent = "Kp לא זמין כרגע"; } catch { $("ifKp").textContent = "Kp לא זמין כרגע"; }
  }
  async function loadExpected(lat, lon) {
    if (Date.now() - lastExpectedAt < 60 * 1000) return;
    lastExpectedAt = Date.now();
    try { const r = await fetch("/api/gnss/expected?lat=" + lat.toFixed(3) + "&lon=" + lon.toFixed(3), { cache: "no-store" }); const d = await r.json(); if (d.available) expected = d; } catch {}
  }
  async function loadCommunity() {
    const box = $("ifCommunity"); if (!box) return;
    try {
      const r = await fetch("/api/gnss/interference?hours=3", { cache: "no-store" }), d = await r.json();
      box.textContent = "";
      if (!d.available) { box.append(el("p", "if-muted", "התמונה הקהילתית תופעל כשמסד הנתונים מחובר.")); return; }
      if (!d.cells.length) { box.append(el("p", "if-muted", "אין דיווחים בשלוש השעות האחרונות.")); return; }
      for (const c of d.cells.slice(0, 8)) {
        const mins = Math.max(1, Math.round((Date.now() - Date.parse(c.last.endsWith("Z") || c.last.includes("+") ? c.last : c.last + "Z")) / 60000));
        const row = el("div", "if-crow " + c.kind);
        row.append(el("b", "", c.kind === "spoof" ? "הטעיה" : "שיבוש"), el("span", "", placeName(c.lat_cell, c.lon_cell)), el("small", "", c.count + " דיווחים · לפני " + (mins >= 60 ? Math.round(mins / 60) + " שע׳" : mins + " דק׳")));
        box.append(row);
      }
    } catch { box.textContent = "התמונה הקהילתית אינה זמינה כרגע."; }
  }

  function log(result, snap) {
    if (!result.kind || (result.level !== "warn" && result.level !== "high")) return;
    const last = lastLogged[result.kind] || 0;
    if (Date.now() - last < 5 * 60 * 1000) return;
    lastLogged[result.kind] = Date.now();
    const net = snap.network, loc = snap.location;
    const entry = { t: new Date().toISOString(), kind: result.kind, score: result.kind === "spoof" ? result.spoof : result.jam, title: result.title, reasons: result.reasons.map((r) => r.text), gnss: loc ? [+loc.lat.toFixed(4), +loc.lon.toFixed(4)] : null, network: net ? [+net.lat.toFixed(4), +net.lon.toFixed(4)] : null };
    const list = store.get("log", []); list.unshift(entry); store.set("log", list.slice(0, 200)); renderLog();
    // The community map gets only a 10 km cell, and only from the network fix: a spoofed fix is the wrong place.
    if (store.get("share", false)) {
      const where = net || (result.kind === "jam" ? loc : null);
      if (where) fetch("/api/gnss/interference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat_cell: Math.round(where.lat * 10) / 10, lon_cell: Math.round(where.lon * 10) / 10, kind: result.kind, score: entry.score }) }).then(loadCommunity).catch(() => {});
    }
  }
  function renderLog() {
    const box = $("ifLog"); if (!box) return;
    const list = store.get("log", []); box.textContent = "";
    $("ifLogCount").textContent = list.length ? list.length + " אירועים" : "";
    if (!list.length) { box.append(el("p", "if-muted", "עוד לא נרשמו אירועים. כל חשד נשמר כאן, עם השעה, המיקום לפי הרשת ומה זוהה.")); return; }
    for (const e of list.slice(0, 20)) {
      const row = el("details", "if-logrow " + e.kind);
      const sum = el("summary"); sum.append(el("b", "", e.title), el("small", "", new Date(e.t).toLocaleString("he-IL") + " · " + e.score + "/100"));
      row.append(sum); const ul = el("ul"); for (const r of e.reasons) ul.append(el("li", "", r));
      if (e.network) ul.append(el("li", "if-muted", "מיקום לפי הרשת: " + e.network.join(", ")));
      if (e.gnss) ul.append(el("li", "if-muted", "מיקום לפי הלוויינים: " + e.gnss.join(", ")));
      row.append(ul); box.append(row);
    }
  }
  function csv() {
    const list = store.get("log", []), q = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    return ["time,kind,score,title,network_lat,network_lon,gnss_lat,gnss_lon,reasons"].concat(list.map((e) => [e.t, e.kind, e.score, q(e.title), e.network ? e.network[0] : "", e.network ? e.network[1] : "", e.gnss ? e.gnss[0] : "", e.gnss ? e.gnss[1] : "", q(e.reasons.join(" | "))].join(","))).join("\n");
  }

  function render(result) {
    card.dataset.level = result.level;
    $("ifTitle").textContent = result.title;
    $("ifScores").textContent = "הטעיה " + result.spoof + "/100 · שיבוש " + result.jam + "/100 · " + result.used + "/" + result.visible + " לוויינים" + (result.cn0 ? " · " + result.cn0.toFixed(0) + " dB-Hz" : "") + (result.netDistKm != null ? " · מרחק מהרשת " + (result.netDistKm < 1 ? Math.round(result.netDistKm * 1000) + " מ׳" : result.netDistKm.toFixed(1) + " ק״מ") : "");
    const ul = $("ifReasons"); ul.textContent = "";
    if (!result.reasons.length) ul.append(el("li", "ok", result.level === "wait" ? "מתחבר למקלט ה־GNSS…" : "כל הבדיקות עברו: המיקום תואם לרשת, האות נראה טבעי והלוויינים במקום שלהם."));
    for (const r of result.reasons) ul.append(el("li", r.sev, r.text));
  }

  function tick() {
    let snap;
    try { snap = JSON.parse(root.HaniaAndroid.getGnssSnapshot() || "{}"); } catch { return; }
    const now = Date.now();
    remember(hist, snap, now);
    const where = snap.network || snap.location;
    if (where) loadExpected(where.lat, where.lon);
    const result = analyze(snap, hist, { expected, kp, now });
    render(result); log(result, snap);
    // Feed the older GNSS panels on the page, which wait for this event.
    const sats = snap.satellites || [], live = sats.filter((s) => s.cn0 > 0), cons = {};
    for (const s of sats) cons[s.constellation] = (cons[s.constellation] || 0) + 1;
    root.dispatchEvent(new CustomEvent("haniaion-native-gnss", { detail: { source: "android-native", satellitesInView: sats.length, satellitesUsed: result.used, avgCn0DbHz: live.length ? live.reduce((s, x) => s + x.cn0, 0) / live.length : 0, accuracyM: snap.location ? snap.location.accuracy : null, constellations: cons, latitude: snap.location ? snap.location.lat : null, longitude: snap.location ? snap.location.lon : null, speedMps: snap.location ? snap.location.speed : null, locationTimeMs: snap.location ? snap.location.time : null, timestamp: now } }));
  }
  function start() {
    if (!native()) return;
    const r = root.HaniaAndroid.startGnssMonitor();
    if (r === "location-permission-required") { $("ifTitle").textContent = "נדרשת הרשאת מיקום מדויק"; $("ifScores").textContent = "מאשרים מיקום מדויק בהגדרות האפליקציה ומנסים שוב."; return; }
    store.set("on", true); $("ifStart").textContent = "הבדיקה פעילה"; $("ifStart").disabled = true; $("ifStop").hidden = false;
    if (!timer) timer = setInterval(tick, 1000);
  }
  function stop() {
    clearInterval(timer); timer = null; store.set("on", false);
    try { root.HaniaAndroid.stopGnssMonitor(); } catch {}
    $("ifStart").textContent = "להתחיל בדיקה"; $("ifStart").disabled = false; $("ifStop").hidden = true;
    card.dataset.level = "idle"; $("ifTitle").textContent = "הבדיקה כבויה";
  }

  $("ifShare").checked = !!store.get("share", false);
  $("ifShare").addEventListener("change", (e) => store.set("share", e.target.checked));
  $("ifStart").addEventListener("click", start);
  $("ifStop").addEventListener("click", stop);
  $("ifCopy").addEventListener("click", () => { const t = csv(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { $("ifCopy").textContent = "הועתק"; setTimeout(() => { $("ifCopy").textContent = "העתקה כ־CSV"; }, 1800); }, () => {}); });
  $("ifDownload").addEventListener("click", () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv()], { type: "text/csv" })); a.download = "haniaion-interference.csv"; document.body.append(a); a.click(); a.remove(); });
  $("ifClear").addEventListener("click", (e) => { if (!e.currentTarget.dataset.armed) { e.currentTarget.dataset.armed = "1"; e.currentTarget.textContent = "ללחוץ שוב למחיקה"; return; } store.set("log", []); renderLog(); e.currentTarget.textContent = "מחיקת היומן"; delete e.currentTarget.dataset.armed; });
  if (native()) { $("ifWeb").hidden = true; card.dataset.level = "idle"; if (store.get("on", false)) start(); }
  else { $("ifControls").hidden = true; card.dataset.level = "web"; $("ifTitle").textContent = "הבדיקה המלאה עובדת באפליקציית Android"; $("ifScores").textContent = "בדפדפן אין גישה לנתוני הלוויינים. כאן אפשר לראות מזג אוויר בחלל ודיווחים מהקהילה."; }
  renderLog(); loadKp(); loadCommunity();
  setInterval(loadKp, 15 * 60 * 1000); setInterval(loadCommunity, 2 * 60 * 1000);
})(typeof window !== "undefined" ? window : globalThis);
