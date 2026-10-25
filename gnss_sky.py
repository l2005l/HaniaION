"""Where the GPS satellites really are right now, and how stormy space weather is.

Two independent checks for the interference monitor on the phone:
- the expected azimuth and elevation of every GPS satellite (public CelesTrak orbits, SGP4),
  so a receiver that "sees" a satellite which is below the horizon is being fed a fake sky;
- the planetary K index from NOAA SWPC, so a weak fix during a geomagnetic storm is not
  mistaken for a jammer.
"""
from __future__ import annotations

import math
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from sgp4.api import Satrec, jday

GPS_TLE_URLS = [
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=TLE",
    "https://www.celestrak.com/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=TLE",
]
GPS_LAST_GOOD = os.path.join("data", "gps_last_good.tle")
KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
KP_FORECAST_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"
# Every navigation system the phones in Israel use, for the "when to measure" forecast.
GROUPS = {"GPS": "gps-ops", "Galileo": "galileo", "GLONASS": "glo-ops", "BeiDou": "beidou"}
_groups: dict[str, dict[str, Any]] = {}
_forecast_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_kpf: dict[str, Any] = {"expires": 0.0, "value": []}
UA = {"User-Agent": "HaniaION-Interference/1.0 (+https://gps.hania360.com)"}

_lock = threading.Lock()
_gps: dict[str, Any] = {"expires": 0.0, "records": [], "fetched_at": None, "mode": None}
_kp: dict[str, Any] = {"expires": 0.0, "value": None}

WGS84_A = 6378.137
WGS84_E2 = 6.69437999014e-3


def parse_gps_tle(text: str) -> list[dict[str, Any]]:
    """Records with the PRN taken from names like 'GPS BIII-5  (PRN 11)'."""
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    out: list[dict[str, Any]] = []
    for i in range(len(lines) - 2):
        name, l1, l2 = lines[i].strip(), lines[i + 1], lines[i + 2]
        if not (l1.startswith("1 ") and l2.startswith("2 ")):
            continue
        m = re.search(r"PRN\s*0*(\d+)", name)
        if not m:
            continue
        try:
            out.append({"prn": int(m.group(1)), "name": name, "satrec": Satrec.twoline2rv(l1, l2)})
        except Exception:
            continue
    return out


def _gps_records() -> tuple[list[dict[str, Any]], str | None, str | None]:
    now = time.time()
    with _lock:
        if _gps["records"] and _gps["expires"] > now:
            return _gps["records"], _gps["fetched_at"], _gps["mode"]
    text, mode = None, None
    for url in GPS_TLE_URLS:
        try:
            r = requests.get(url, headers=UA, timeout=12)
            if r.ok and "PRN" in r.text:
                text, mode = r.text, "live"
                try:
                    os.makedirs("data", exist_ok=True)
                    with open(GPS_LAST_GOOD, "w", encoding="utf-8") as fh:
                        fh.write(text)
                except OSError:
                    pass
                break
        except requests.RequestException:
            continue
    if text is None and os.path.exists(GPS_LAST_GOOD):
        with open(GPS_LAST_GOOD, encoding="utf-8") as fh:
            text, mode = fh.read(), "last-good"
    records = parse_gps_tle(text or "")
    fetched = datetime.now(timezone.utc).isoformat()
    with _lock:
        _gps.update(expires=now + (6 * 3600 if mode == "live" else 600), records=records, fetched_at=fetched, mode=mode)
    return records, fetched, mode


def _gmst(jd_ut1: float) -> float:
    """Greenwich mean sidereal time in radians (IAU 1982)."""
    t = (jd_ut1 - 2451545.0) / 36525.0
    sec = 67310.54841 + (876600.0 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t ** 3
    return math.radians((sec % 86400) / 240.0) % (2 * math.pi)


def observer_ecef(lat: float, lon: float, h_km: float = 0.0) -> tuple[float, float, float]:
    la, lo = math.radians(lat), math.radians(lon)
    n = WGS84_A / math.sqrt(1 - WGS84_E2 * math.sin(la) ** 2)
    return ((n + h_km) * math.cos(la) * math.cos(lo), (n + h_km) * math.cos(la) * math.sin(lo), (n * (1 - WGS84_E2) + h_km) * math.sin(la))


def look_angles(sat_ecef: tuple[float, float, float], lat: float, lon: float) -> tuple[float, float]:
    """Azimuth and elevation in degrees of a point in ECEF (km) seen from the observer."""
    ox, oy, oz = observer_ecef(lat, lon)
    dx, dy, dz = sat_ecef[0] - ox, sat_ecef[1] - oy, sat_ecef[2] - oz
    la, lo = math.radians(lat), math.radians(lon)
    e = -math.sin(lo) * dx + math.cos(lo) * dy
    n = -math.sin(la) * math.cos(lo) * dx - math.sin(la) * math.sin(lo) * dy + math.cos(la) * dz
    u = math.cos(la) * math.cos(lo) * dx + math.cos(la) * math.sin(lo) * dy + math.sin(la) * dz
    rng = math.sqrt(e * e + n * n + u * u)
    return (math.degrees(math.atan2(e, n)) % 360.0, math.degrees(math.asin(u / rng)))


def expected_sky(lat: float, lon: float, when: datetime | None = None) -> dict[str, Any]:
    when = when or datetime.now(timezone.utc)
    records, fetched, mode = _gps_records()
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute, when.second + when.microsecond / 1e6)
    theta = _gmst(jd + fr)
    sats = []
    for rec in records:
        err, r, _ = rec["satrec"].sgp4(jd, fr)
        if err:
            continue
        # TEME to Earth-fixed: rotate by sidereal time (polar motion is far below what matters here).
        x = math.cos(theta) * r[0] + math.sin(theta) * r[1]
        y = -math.sin(theta) * r[0] + math.cos(theta) * r[1]
        az, el = look_angles((x, y, r[2]), lat, lon)
        sats.append({"prn": rec["prn"], "azimuth": round(az, 1), "elevation": round(el, 1)})
    sats.sort(key=lambda s: s["prn"])
    return {"available": bool(sats), "mode": mode, "tle_fetched_at": fetched, "computed_at": when.isoformat(), "lat": round(lat, 3), "lon": round(lon, 3), "gps": sats}


def read_kp(payload: Any) -> dict[str, Any] | None:
    """The latest Kp from SWPC's JSON (a header row plus rows, or a list of objects)."""
    if not isinstance(payload, list) or not payload:
        return None
    last = payload[-1]
    if isinstance(last, dict):
        kp, tag = last.get("Kp", last.get("kp_index")), last.get("time_tag")
    elif isinstance(last, list) and len(last) >= 2:
        tag, kp = last[0], last[1]
    else:
        return None
    try:
        value = float(kp)
    except (TypeError, ValueError):
        return None
    level = "storm" if value >= 5 else "active" if value >= 4 else "quiet"
    return {"kp": round(value, 2), "time_tag": tag, "level": level}


def space_weather() -> dict[str, Any]:
    now = time.time()
    with _lock:
        if _kp["value"] is not None and _kp["expires"] > now:
            return _kp["value"]
    try:
        r = requests.get(KP_URL, headers=UA, timeout=10)
        value = read_kp(r.json()) if r.ok else None
    except (requests.RequestException, ValueError):
        value = None
    result = {"available": bool(value), "source": "NOAA SWPC", **(value or {})}
    with _lock:
        _kp.update(expires=now + (900 if value else 120), value=result)
    return result


def _group_records(system: str) -> list[Any]:
    """Satrecs for one system (CelesTrak group), cached for 6 hours with a last-good copy on disk."""
    now = time.time()
    with _lock:
        c = _groups.get(system)
        if c and c["expires"] > now:
            return c["records"]
    group, path, text = GROUPS[system], os.path.join("data", f"{GROUPS[system]}_last_good.tle"), None
    for host in ("celestrak.org", "www.celestrak.com"):
        try:
            r = requests.get(f"https://{host}/NORAD/elements/gp.php?GROUP={group}&FORMAT=TLE", headers=UA, timeout=12)
            if r.ok and r.text.count("\n1 ") >= 3:
                text = r.text
                try:
                    os.makedirs("data", exist_ok=True)
                    with open(path, "w", encoding="utf-8") as fh:
                        fh.write(text)
                except OSError:
                    pass
                break
        except requests.RequestException:
            continue
    live = text is not None
    if text is None and os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    lines = [ln.rstrip() for ln in (text or "").splitlines() if ln.strip()]
    recs = []
    for i in range(len(lines) - 2):
        if lines[i + 1].startswith("1 ") and lines[i + 2].startswith("2 ") and not lines[i].startswith(("1 ", "2 ")):
            try:
                recs.append(Satrec.twoline2rv(lines[i + 1], lines[i + 2]))
            except Exception:
                pass
    with _lock:
        _groups[system] = {"expires": now + (6 * 3600 if live else 600), "records": recs}
    return recs


def _inv4(m: list[list[float]]) -> list[list[float]] | None:
    """Inverse of a 4x4 matrix (Gauss-Jordan); None when singular."""
    a = [row[:] + [1.0 if i == j else 0.0 for j in range(4)] for i, row in enumerate(m)]
    for c in range(4):
        p = max(range(c, 4), key=lambda r: abs(a[r][c]))
        if abs(a[p][c]) < 1e-12:
            return None
        a[c], a[p] = a[p], a[c]
        piv = a[c][c]
        a[c] = [x / piv for x in a[c]]
        for r in range(4):
            if r != c and a[r][c]:
                f = a[r][c]
                a[r] = [x - f * y for x, y in zip(a[r], a[c])]
    return [row[4:] for row in a]


def dop(look: list[tuple[float, float]]) -> dict[str, float] | None:
    """PDOP, HDOP and VDOP from (azimuth, elevation) in degrees, one receiver clock."""
    if len(look) < 4:
        return None
    n = [[0.0] * 4 for _ in range(4)]
    for az, el in look:
        a, e = math.radians(az), math.radians(el)
        g = (math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e), 1.0)
        for i in range(4):
            for j in range(4):
                n[i][j] += g[i] * g[j]
    q = _inv4(n)
    if not q or min(q[0][0], q[1][1], q[2][2]) < 0:
        return None
    return {"pdop": round(math.sqrt(q[0][0] + q[1][1] + q[2][2]), 2), "hdop": round(math.sqrt(q[0][0] + q[1][1]), 2), "vdop": round(math.sqrt(q[2][2]), 2)}


def kp_forecast() -> list[dict[str, Any]]:
    now = time.time()
    with _lock:
        if _kpf["expires"] > now:
            return _kpf["value"]
    out: list[dict[str, Any]] = []
    try:
        r = requests.get(KP_FORECAST_URL, headers=UA, timeout=10)
        rows = r.json() if r.ok else []
        for row in rows[1:] if rows and isinstance(rows[0], list) else rows:
            tag, kp = (row[0], row[1]) if isinstance(row, list) else (row.get("time_tag"), row.get("kp"))
            try:
                out.append({"time": str(tag).replace(" ", "T")[:19] + "Z", "kp": float(kp)})
            except (TypeError, ValueError):
                continue
    except (requests.RequestException, ValueError):
        out = []
    with _lock:
        _kpf.update(expires=now + (1800 if out else 300), value=out)
    return out


def forecast(lat: float, lon: float, hours: int = 12, step_min: int = 10, mask: float = 15.0, start: datetime | None = None) -> dict[str, Any]:
    """Satellites above the mask and DOP every `step_min` minutes, and the best and worst windows."""
    start = (start or datetime.now(timezone.utc)).replace(second=0, microsecond=0)
    key = f"{round(lat, 1)}:{round(lon, 1)}:{hours}:{step_min}:{mask}:{start.isoformat()[:15]}"
    hit = _forecast_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    systems = {name: _group_records(name) for name in GROUPS}
    steps = []
    for k in range(int(hours * 60 / step_min) + 1):
        when = start + timedelta(minutes=k * step_min)
        jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute, 0)
        theta = _gmst(jd + fr)
        look, counts = [], {}
        for name, recs in systems.items():
            c = 0
            for rec in recs:
                err, r, _ = rec.sgp4(jd, fr)
                if err:
                    continue
                x = math.cos(theta) * r[0] + math.sin(theta) * r[1]
                y = -math.sin(theta) * r[0] + math.cos(theta) * r[1]
                az, el = look_angles((x, y, r[2]), lat, lon)
                if el >= mask:
                    c += 1
                    look.append((az, el))
            counts[name] = c
        d = dop(look) or {}
        steps.append({"time": when.isoformat().replace("+00:00", "Z"), "count": len(look), "by_system": counts, **d})
    kp = kp_forecast()
    for s in steps:
        t = s["time"]
        prior = [f for f in kp if f["time"] <= t]
        if prior:
            s["kp"] = prior[-1]["kp"]
    good = [s.get("pdop") is not None and s["pdop"] <= 2.0 and s["count"] >= 12 and s.get("kp", 0) < 5 for s in steps]
    bad = [s.get("pdop") is None or s["pdop"] > 4.0 or s["count"] < 8 or s.get("kp", 0) >= 5 for s in steps]

    def runs(flags: list[bool]) -> list[tuple[int, int]]:
        out, i = [], 0
        while i < len(flags):
            if flags[i]:
                j = i
                while j + 1 < len(flags) and flags[j + 1]:
                    j += 1
                out.append((i, j))
                i = j + 1
            else:
                i += 1
        return out

    best = None
    for i, j in runs(good):
        if (j - i + 1) * step_min < 30:
            continue
        mean = sum(steps[k]["pdop"] for k in range(i, j + 1)) / (j - i + 1)
        if best is None or mean < best[2] - 0.05 or (abs(mean - best[2]) <= 0.05 and j - i > best[1] - best[0]):
            best = (i, j, mean)
    result = {
        "available": any(systems.values()),
        "lat": round(lat, 3), "lon": round(lon, 3), "mask_deg": mask, "step_min": step_min,
        "systems": {k: len(v) for k, v in systems.items()},
        "steps": steps,
        "best": {"from": steps[best[0]]["time"], "to": steps[best[1]]["time"], "mean_pdop": round(best[2], 2)} if best else None,
        "avoid": [{"from": steps[i]["time"], "to": steps[j]["time"]} for i, j in runs(bad)][:6],
        "kp_available": bool(kp),
    }
    _forecast_cache[key] = (time.time() + 600, result)
    return result
