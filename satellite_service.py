from __future__ import annotations

import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from sgp4.api import Satrec, jday
from urllib3.util.retry import Retry

CELESTRAK_RESOURCE_URLS = [
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=RESOURCE&FORMAT=TLE",
    "https://www.celestrak.org/NORAD/elements/gp.php?GROUP=RESOURCE&FORMAT=TLE",
    "https://celestrak.com/NORAD/elements/gp.php?GROUP=RESOURCE&FORMAT=TLE",
    "https://www.celestrak.com/NORAD/elements/gp.php?GROUP=RESOURCE&FORMAT=TLE",
]
BOOTSTRAP_TLE_PATH = os.path.join("data", "resource_bootstrap.tle")
LAST_GOOD_TLE_PATH = os.path.join("data", "resource_last_good.tle")
ISRAEL_LAT = 31.5
ISRAEL_LON = 34.8
EARTH_RADIUS_KM = 6371.0
CACHE_SECONDS = 2 * 60 * 60
MAX_OBJECTS = 500

_cache_lock = threading.Lock()
_cache: dict[str, Any] = {"expires": 0.0, "records": [], "fetched_at": None, "mode": None, "warning": None}

SAR_HINTS = ("SENTINEL-1", "RADARSAT", "ICEYE", "CAPELLA", "SAOCOM", "TERRASAR", "TANDEM-X", "KOMPSAT-5", "NISAR")
OPTICAL_HINTS = ("LANDSAT", "SENTINEL-2", "WORLDVIEW", "GEOEYE", "PLEIADES", "SPOT", "CARTOSAT", "PRISMA", "RESOURCESAT", "KANOPUS", "SKYSAT")
SCIENCE_HINTS = ("TERRA", "AQUA", "SUOMI", "JPSS", "CALIPSO", "CLOUDSAT", "OCO-", "GCOM", "HY-", "SWOT")


def _session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=3, connect=3, read=3, backoff_factor=0.8,
                  status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET"])
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({
        "User-Agent": "HaniaION-Satellite/3.1 (+https://haniaion.onrender.com)",
        "Accept": "text/plain,text/*;q=0.9,*/*;q=0.5",
        "Cache-Control": "no-cache",
    })
    return session


def _classify(name: str) -> tuple[str, str, float]:
    upper = name.upper()
    if any(h in upper for h in SAR_HINTS):
        return "sar", "Earth observation radar", 900.0
    if any(h in upper for h in OPTICAL_HINTS):
        return "optical", "Earth observation optical", 600.0
    if any(h in upper for h in SCIENCE_HINTS):
        return "science", "Earth science", 1000.0
    return "observation", "Earth resources / observation", 700.0


def _parse_tle(text: str) -> list[dict[str, Any]]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    records: list[dict[str, Any]] = []
    i = 0
    while i + 2 < len(lines):
        name, line1, line2 = lines[i], lines[i + 1], lines[i + 2]
        i += 3
        if not line1.startswith("1 ") or not line2.startswith("2 "):
            continue
        try:
            satrec = Satrec.twoline2rv(line1, line2)
            sat_type, mission, footprint_km = _classify(name)
            records.append({
                "name": name,
                "norad_id": int(line1[2:7]),
                "line1": line1,
                "line2": line2,
                "satrec": satrec,
                "type": sat_type,
                "mission": mission,
                "footprint_km": footprint_km,
            })
        except Exception:
            continue
    return records[:MAX_OBJECTS]


def _read_local_tle(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _write_last_good(text: str) -> None:
    try:
        os.makedirs(os.path.dirname(LAST_GOOD_TLE_PATH), exist_ok=True)
        with open(LAST_GOOD_TLE_PATH, "w", encoding="utf-8") as handle:
            handle.write(text)
    except OSError:
        pass


def get_records() -> tuple[list[dict[str, Any]], str, str, str | None]:
    now = time.time()
    with _cache_lock:
        if _cache["records"] and _cache["expires"] > now:
            return _cache["records"], _cache["fetched_at"], _cache["mode"], _cache["warning"]

    errors: list[str] = []
    session = _session()
    for url in CELESTRAK_RESOURCE_URLS:
        try:
            response = session.get(url, timeout=(8, 30), allow_redirects=True)
            response.raise_for_status()
            records = _parse_tle(response.text)
            if not records:
                raise RuntimeError("source returned no usable records")
            fetched_at = datetime.now(timezone.utc).isoformat()
            _write_last_good(response.text)
            with _cache_lock:
                _cache.update(records=records, expires=now + CACHE_SECONDS, fetched_at=fetched_at, mode="live", warning=None)
            return records, fetched_at, "live", None
        except Exception as error:
            errors.append(f"{url}: {error}")

    for path, mode, ttl in ((LAST_GOOD_TLE_PATH, "last_good_cache", 30 * 60), (BOOTSTRAP_TLE_PATH, "bundled_fallback", 15 * 60)):
        try:
            text = _read_local_tle(path)
            records = _parse_tle(text)
            if not records:
                continue
            fetched_at = datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat()
            age = max(0.0, now - os.path.getmtime(path))
            warning = (
                "החיבור החי ל-CelesTrak אינו זמין; נתוני TLE שמורים ועדכניים יחסית נמצאים בשימוש."
                if age <= 24 * 60 * 60
                else "החיבור החי ל-CelesTrak אינו זמין; נתוני TLE שמורים וישנים נמצאים בשימוש."
            )
            with _cache_lock:
                _cache.update(records=records, expires=now + ttl, fetched_at=fetched_at, mode=mode, warning=warning)
            return records, fetched_at, mode, warning
        except OSError:
            continue

    raise RuntimeError("Satellite source unavailable and no local cache exists: " + " | ".join(errors[-2:]))


def _gmst(dt: datetime) -> float:
    jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)
    t = (jd + fr - 2451545.0) / 36525.0
    value = 280.46061837 + 360.98564736629 * (jd + fr - 2451545.0) + 0.000387933 * t * t - t * t * t / 38710000.0
    return math.radians(value % 360.0)


def _position(record: dict[str, Any], dt: datetime) -> dict[str, float] | None:
    jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)
    error, pos, _vel = record["satrec"].sgp4(jd, fr)
    if error != 0:
        return None
    x, y, z = pos
    theta = _gmst(dt)
    xe = x * math.cos(theta) + y * math.sin(theta)
    ye = -x * math.sin(theta) + y * math.cos(theta)
    lon = math.degrees(math.atan2(ye, xe))
    hyp = math.hypot(xe, ye)
    lat = math.degrees(math.atan2(z, hyp))
    radius = math.sqrt(xe * xe + ye * ye + z * z)
    return {"lat": lat, "lon": lon, "alt_km": max(0.0, radius - EARTH_RADIUS_KM)}


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def build_coverage(minutes_ahead: int = 90, step_seconds: int = 60) -> dict[str, Any]:
    records, fetched_at, source_mode, source_warning = get_records()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    objects: list[dict[str, Any]] = []
    occupancy: list[bool] = []
    steps = max(1, int(minutes_ahead * 60 / step_seconds))
    future_times = [now + timedelta(seconds=i * step_seconds) for i in range(steps + 1)]

    for record in records:
        points: list[dict[str, Any]] = []
        visible_indices: list[int] = []
        for idx, dt in enumerate(future_times):
            pos = _position(record, dt)
            if pos is None:
                continue
            distance = _distance_km(ISRAEL_LAT, ISRAEL_LON, pos["lat"], pos["lon"])
            horizon_km = EARTH_RADIUS_KM * math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + max(1.0, pos["alt_km"])))
            coverage_radius_km = max(record["footprint_km"], min(2600.0, horizon_km * 0.72))
            capable = distance <= coverage_radius_km
            if capable:
                visible_indices.append(idx)
            if idx == 0 or idx % 3 == 0:
                points.append({"time": dt.isoformat(), **{k: round(v, 3) for k, v in pos.items()}, "distance_km": round(distance, 1)})
        current = _position(record, now)
        if current is None:
            continue
        current_distance = _distance_km(ISRAEL_LAT, ISRAEL_LON, current["lat"], current["lon"])
        current_horizon = EARTH_RADIUS_KM * math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + max(1.0, current["alt_km"])))
        coverage_radius = max(record["footprint_km"], min(2600.0, current_horizon * 0.72))
        status = "visible" if current_distance <= coverage_radius else "away"
        next_entry = next((i for i in visible_indices if i > 0), None)
        if status == "away" and next_entry is not None and next_entry * step_seconds <= 15 * 60:
            status = "near"
        objects.append({
            "name": record["name"], "norad_id": record["norad_id"], "type": record["type"],
            "mission": record["mission"], "status": status,
            "lat": round(current["lat"], 3), "lon": round(current["lon"], 3),
            "alt_km": round(current["alt_km"], 1), "distance_km": round(current_distance, 1),
            "estimated_footprint_km": round(coverage_radius, 1),
            "next_entry_minutes": round(next_entry * step_seconds / 60) if next_entry is not None else None,
            "track": points,
            "windows": _windows(visible_indices, future_times, step_seconds),
        })

    for idx in range(len(future_times)):
        occupancy.append(any(any(w["start_index"] <= idx <= w["end_index"] for w in obj["windows"]) for obj in objects))
    no_coverage = _boolean_windows([not x for x in occupancy], future_times, step_seconds)
    for obj in objects:
        for w in obj["windows"]:
            w.pop("start_index", None); w.pop("end_index", None)
    objects.sort(key=lambda x: (0 if x["status"] == "visible" else 1 if x["status"] == "near" else 2, x["distance_km"]))
    visible = [x for x in objects if x["status"] == "visible"]
    return {
        "generated_at": now.isoformat(), "tle_fetched_at": fetched_at,
        "source": "CelesTrak Earth Resources GP/TLE + SGP4",
        "source_mode": source_mode, "source_warning": source_warning,
        "source_fresh": source_mode == "live" or (
            bool(fetched_at) and (now - datetime.fromisoformat(fetched_at).astimezone(timezone.utc)) <= timedelta(hours=24)
        ),
        "definition": "Public Earth-observation orbit geometry; sensor activity and pointing are unknown.",
        "location": {"name": "Israel", "lat": ISRAEL_LAT, "lon": ISRAEL_LON},
        "counts": {"total": len(objects), "visible": len(visible), "near": sum(x["status"] == "near" for x in objects),
                   "optical": sum(x["status"] == "visible" and x["type"] == "optical" for x in objects),
                   "sar": sum(x["status"] == "visible" and x["type"] == "sar" for x in objects),
                   "science": sum(x["status"] == "visible" and x["type"] == "science" for x in objects)},
        "no_coverage_windows": no_coverage,
        "objects": objects,
    }


def _windows(indices: list[int], times: list[datetime], step_seconds: int) -> list[dict[str, Any]]:
    flags = [False] * len(times)
    for i in indices:
        if 0 <= i < len(flags): flags[i] = True
    return _boolean_windows(flags, times, step_seconds, include_indices=True)


def _boolean_windows(flags: list[bool], times: list[datetime], step_seconds: int, include_indices: bool = False) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    start = None
    for i, flag in enumerate(flags + [False]):
        if flag and start is None: start = i
        if not flag and start is not None:
            end = i - 1
            item = {"start": times[start].isoformat(), "end": (times[end] + timedelta(seconds=step_seconds)).isoformat(),
                    "duration_minutes": round((end - start + 1) * step_seconds / 60)}
            if include_indices: item.update(start_index=start, end_index=end)
            result.append(item); start = None
    return result
