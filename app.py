from __future__ import annotations

import gzip
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


APP_NAME = "HaniaION RAAM"
CDDIS_BASE = "https://cddis.nasa.gov/archive/gnss/data/daily"
EARTHDATA_HOST = "urs.earthdata.nasa.gov"



# Approximate pressure-level heights used by the wind dashboard.
WIND_LEVELS = {
    0: {"kind": "surface", "label": "10 m AGL", "speed": "wind_speed_10m", "direction": "wind_direction_10m"},
    5000: {"kind": "pressure", "hpa": 850, "label": "850 hPa (~5,000 ft)"},
    10000: {"kind": "pressure", "hpa": 700, "label": "700 hPa (~10,000 ft)"},
    15000: {"kind": "pressure", "hpa": 600, "label": "600 hPa (~14,000 ft)"},
    20000: {"kind": "pressure", "hpa": 500, "label": "500 hPa (~18,000 ft)"},
    25000: {"kind": "pressure", "hpa": 400, "label": "400 hPa (~24,000 ft)"},
    30000: {"kind": "pressure", "hpa": 300, "label": "300 hPa (~30,000 ft)"},
    35000: {"kind": "pressure", "hpa": 250, "label": "250 hPa (~34,000 ft)"},
    40000: {"kind": "pressure", "hpa": 200, "label": "200 hPa (~39,000 ft)"},
    45000: {"kind": "pressure", "hpa": 150, "label": "150 hPa (~44,000 ft)"},
    50000: {"kind": "pressure", "hpa": 100, "label": "100 hPa (~52,000 ft)"},
}

# A deliberately compact grid keeps the upstream request reliable on Render.
# The browser interpolates these samples into a continuous colored field.
WIND_REGION = {
    "lat_min": 17.0, "lat_max": 42.0,
    "lon_min": 20.0, "lon_max": 65.0,
    "lat_step": 5.0, "lon_step": 5.0,
}

_wind_cache_lock = threading.Lock()
_wind_cache: dict[str, Any] = {}

def _nearest_wind_level(altitude_ft: int) -> tuple[int, dict[str, Any]]:
    chosen = min(WIND_LEVELS, key=lambda value: abs(value - altitude_ft))
    return chosen, WIND_LEVELS[chosen]

def _wind_grid_points() -> tuple[list[float], list[float]]:
    lats: list[float] = []
    lons: list[float] = []
    lat = WIND_REGION["lat_min"]
    while lat <= WIND_REGION["lat_max"] + 0.001:
        lon = WIND_REGION["lon_min"]
        while lon <= WIND_REGION["lon_max"] + 0.001:
            lats.append(round(lat, 2))
            lons.append(round(lon, 2))
            lon += WIND_REGION["lon_step"]
        lat += WIND_REGION["lat_step"]
    return lats, lons

def _request_open_meteo(params: dict[str, Any]) -> Any:
    session = requests.Session()
    retry = Retry(total=3, connect=3, read=3, backoff_factor=0.8,
                  status_forcelist=[429, 500, 502, 503, 504],
                  allowed_methods=["GET"])
    session.mount("https://", HTTPAdapter(max_retries=retry))
    response = session.get(
        "https://api.open-meteo.com/v1/forecast",
        params=params, timeout=(10, 40),
        headers={"User-Agent": "HaniaION-Wind/5.0", "Accept": "application/json"},
    )
    response.raise_for_status()
    return response.json()

def fetch_wind_grid(altitude_ft: int, forecast_hour: int) -> dict[str, Any]:
    selected_ft, level = _nearest_wind_level(altitude_ft)
    forecast_hour = max(0, min(72, int(forecast_hour)))
    cache_key = f"{selected_ft}:{forecast_hour}"
    now = time.time()
    with _wind_cache_lock:
        cached = _wind_cache.get(cache_key)
        if cached and cached["expires_at"] > now:
            payload = dict(cached["payload"]); payload["cached"] = True; return payload

    lats, lons = _wind_grid_points()
    if level["kind"] == "surface":
        speed_var, direction_var = level["speed"], level["direction"]
    else:
        hpa = level["hpa"]
        speed_var = f"wind_speed_{hpa}hPa"
        direction_var = f"wind_direction_{hpa}hPa"

    params = {
        "latitude": ",".join(map(str, lats)),
        "longitude": ",".join(map(str, lons)),
        "hourly": f"{speed_var},{direction_var}",
        "wind_speed_unit": "kn",
        "forecast_days": 4,
        "timezone": "UTC",
    }
    raw = _request_open_meteo(params)
    locations = raw if isinstance(raw, list) else [raw]
    target_time = datetime.now(timezone.utc) + timedelta(hours=forecast_hour)
    points: list[dict[str, Any]] = []
    valid_time: str | None = None
    for location in locations:
        hourly = location.get("hourly") or {}
        times = hourly.get("time") or []
        speeds = hourly.get(speed_var) or []
        directions = hourly.get(direction_var) or []
        if not times or not speeds or not directions:
            continue
        parsed = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in times]
        idx = min(range(len(parsed)), key=lambda i: abs((parsed[i]-target_time).total_seconds()))
        if idx >= len(speeds) or idx >= len(directions) or speeds[idx] is None or directions[idx] is None:
            continue
        valid_time = valid_time or times[idx]
        points.append({
            "latitude": float(location.get("latitude")),
            "longitude": float(location.get("longitude")),
            "speed_knots": round(float(speeds[idx]), 1),
            "direction_degrees": round(float(directions[idx])) % 360,
        })
    if len(points) < 20:
        raise RuntimeError(f"Wind provider returned only {len(points)} usable samples.")

    payload = {
        "requested_altitude_ft": altitude_ft, "selected_altitude_ft": selected_ft,
        "level_label": level["label"], "forecast_hour": forecast_hour,
        "valid_time_utc": valid_time, "source": "Open-Meteo forecast",
        "region": WIND_REGION, "points": points, "cached": False,
    }
    with _wind_cache_lock:
        _wind_cache[cache_key] = {"payload": payload, "expires_at": now + 20*60}
    return payload

app = FastAPI(title=APP_NAME)
app.mount("/static", StaticFiles(directory="static"), name="static")

_cache_lock = threading.Lock()
_cache: dict[str, Any] = {
    "result": None,
    "expires_at": 0.0,
}

_rate_lock = threading.Lock()
_rate_history: dict[str, list[float]] = {}


class EarthdataSession(requests.Session):
    def rebuild_auth(self, prepared_request, response):
        headers = prepared_request.headers

        if "Authorization" not in headers:
            return

        original = urlparse(response.request.url)
        redirected = urlparse(prepared_request.url)

        if (
            original.hostname != redirected.hostname
            and redirected.hostname != EARTHDATA_HOST
            and original.hostname != EARTHDATA_HOST
        ):
            del headers["Authorization"]


def create_session() -> EarthdataSession:
    username = os.getenv("EARTHDATA_USERNAME", "").strip()
    password = os.getenv("EARTHDATA_PASSWORD", "")

    if not username or not password:
        raise RuntimeError(
            "פרטי Earthdata לא הוגדרו בשרת."
        )

    session = EarthdataSession()
    session.auth = (username, password)
    session.headers.update(
        {
            "User-Agent": "HaniaION-RAAM/1.0",
            "Accept": "*/*",
        }
    )

    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )

    session.mount(
        "https://",
        HTTPAdapter(max_retries=retry),
    )

    return session


def check_rate_limit(client_ip: str) -> None:
    now = time.time()
    cutoff = now - 60

    with _rate_lock:
        recent = [
            stamp
            for stamp in _rate_history.get(client_ip, [])
            if stamp > cutoff
        ]

        if len(recent) >= 12:
            raise HTTPException(
                status_code=429,
                detail="יותר מדי בקשות. נסה שוב בעוד דקה.",
            )

        recent.append(now)
        _rate_history[client_ip] = recent


def candidate_file_names(day: date) -> list[str]:
    year = day.year
    doy = day.timetuple().tm_yday
    yy = year % 100

    return [
        f"BRDC00IGS_R_{year}{doy:03d}0000_01D_MN.rnx.gz",
        f"brdc{doy:03d}0.{yy:02d}n.gz",
    ]


def directory_url(day: date) -> str:
    return f"{CDDIS_BASE}/{day.year}/brdc/"


def is_gzip_response(response: requests.Response) -> bool:
    content_type = response.headers.get("Content-Type", "").lower()

    if "text/html" in content_type:
        return False

    return response.content[:2] == b"\x1f\x8b"


def download_latest_brdc(
    session: EarthdataSession,
) -> tuple[str, bytes, date]:
    today = datetime.now(timezone.utc).date()
    errors: list[str] = []

    for offset in range(7):
        target_day = today - timedelta(days=offset)
        base_url = directory_url(target_day)

        for file_name in candidate_file_names(target_day):
            try:
                response = session.get(
                    base_url + file_name,
                    timeout=(20, 180),
                    allow_redirects=True,
                )

                if response.status_code == 404:
                    continue

                response.raise_for_status()

                if is_gzip_response(response):
                    return file_name, response.content, target_day

            except requests.RequestException as error:
                errors.append(f"{file_name}: {error}")

    for offset in range(7):
        target_day = today - timedelta(days=offset)
        base_url = directory_url(target_day)

        try:
            response = session.get(
                base_url,
                timeout=(20, 180),
                allow_redirects=True,
            )
            response.raise_for_status()

            links = re.findall(
                r'href=["\']([^"\']+(?:\.rnx\.gz|\.n\.gz))["\']',
                response.text,
                flags=re.IGNORECASE,
            )

            file_names = [
                link.split("/")[-1]
                for link in links
                if "brdc" in link.lower()
            ]

            for file_name in sorted(
                set(file_names),
                reverse=True,
            ):
                file_response = session.get(
                    base_url + file_name,
                    timeout=(20, 180),
                    allow_redirects=True,
                )
                file_response.raise_for_status()

                if is_gzip_response(file_response):
                    return (
                        file_name,
                        file_response.content,
                        target_day,
                    )

        except requests.RequestException as error:
            errors.append(f"{base_url}: {error}")

    detail = "\n".join(errors[-3:])

    raise RuntimeError(
        "לא נמצא קובץ BRDC תקין בשבעת הימים האחרונים."
        + (f"\n{detail}" if detail else "")
    )


def parse_klobuchar(rinex_text: str) -> dict[str, Any]:
    alpha: list[float] = []
    beta: list[float] = []
    leap_seconds: int | None = None

    for line in rinex_text.splitlines():
        if "END OF HEADER" in line:
            break

        if "ION ALPHA" in line:
            values = line[:60].replace("D", "E").split()
            alpha = [float(value) for value in values[:4]]

        elif "ION BETA" in line:
            values = line[:60].replace("D", "E").split()
            beta = [float(value) for value in values[:4]]

        elif "IONOSPHERIC CORR" in line:
            values = line[:60].replace("D", "E").split()

            if values and values[0] == "GPSA":
                alpha = [float(value) for value in values[1:5]]

            elif values and values[0] == "GPSB":
                beta = [float(value) for value in values[1:5]]

        elif "LEAP SECONDS" in line:
            values = line[:60].split()

            if values:
                leap_seconds = int(values[0])

    if len(alpha) != 4:
        raise ValueError("לא נמצאו ארבעה ערכי Alpha.")

    if len(beta) != 4:
        raise ValueError("לא נמצאו ארבעה ערכי Beta.")

    if leap_seconds is None:
        raise ValueError("לא נמצא ערך LEAP SECONDS.")

    return {
        "alpha": alpha,
        "beta": beta,
        "leap_seconds": leap_seconds,
    }


def format_for_raam(
    klob_data: dict[str, Any],
) -> dict[str, int]:
    alpha = klob_data["alpha"].copy()
    beta = klob_data["beta"].copy()

    alpha[0] *= 2**30
    alpha[1] *= 2**27
    alpha[2] *= 2**24
    alpha[3] *= 2**24

    beta[0] /= 2**11
    beta[1] /= 2**14
    beta[2] /= 2**16
    beta[3] /= 2**16

    alpha = [round(value) & 0xFF for value in alpha]
    beta = [round(value) & 0xFF for value in beta]

    return {
        "data1": (alpha[0] << 8) | alpha[1],
        "data2": (alpha[2] << 8) | alpha[3],
        "data3": (beta[0] << 8) | beta[1],
        "data4": (beta[2] << 8) | beta[3],
        "tls": int(klob_data["leap_seconds"]),
    }


def calculate_latest() -> dict[str, Any]:
    with _cache_lock:
        if (
            _cache["result"] is not None
            and time.time() < _cache["expires_at"]
        ):
            result = dict(_cache["result"])
            result["cached"] = True
            return result

    session = create_session()

    file_name, compressed_data, source_day = (
        download_latest_brdc(session)
    )

    try:
        decompressed = gzip.decompress(compressed_data)
    except (gzip.BadGzipFile, EOFError) as error:
        raise RuntimeError(
            "קובץ ה-BRDC שהתקבל פגום."
        ) from error

    rinex_text = decompressed.decode(
        "ascii",
        errors="replace",
    )

    klob = parse_klobuchar(rinex_text)
    raam = format_for_raam(klob)

    result = {
        "file_name": file_name,
        "source_date": source_day.isoformat(),
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "alpha": klob["alpha"],
        "beta": klob["beta"],
        **raam,
        "cached": False,
    }

    with _cache_lock:
        _cache["result"] = result
        _cache["expires_at"] = time.time() + 15 * 60

    return result


@app.get("/")
def index():
    return FileResponse("static/index.html")




@app.get("/wind")
def wind_page():
    return FileResponse("static/wind.html")


@app.get("/api/wind/grid")
def wind_grid(altitude_ft: int = 0, forecast_hour: int = 0):
    try:
        return fetch_wind_grid(altitude_ft, forecast_hour)
    except requests.Timeout as error:
        raise HTTPException(
            status_code=504,
            detail="Wind-data request timed out.",
        ) from error
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Wind provider error: {error}") from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Wind service error: {error}") from error

@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(
        "static/manifest.webmanifest",
        media_type="application/manifest+json",
    )


@app.get("/service-worker.js")
def service_worker():
    return FileResponse(
        "static/service-worker.js",
        media_type="application/javascript",
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/calculate")
def calculate(request: Request):
    client_ip = (
        request.client.host
        if request.client
        else "unknown"
    )

    check_rate_limit(client_ip)

    try:
        return calculate_latest()

    except requests.Timeout as error:
        raise HTTPException(
            status_code=504,
            detail="החיבור ל-CDDIS ארך יותר מדי זמן.",
        ) from error

    except requests.HTTPError as error:
        status = (
            error.response.status_code
            if error.response is not None
            else 502
        )

        raise HTTPException(
            status_code=502,
            detail=f"שגיאת CDDIS/Earthdata: HTTP {status}",
        ) from error

    except requests.RequestException as error:
        raise HTTPException(
            status_code=502,
            detail=f"לא ניתן להתחבר ל-CDDIS: {error}",
        ) from error

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        ) from error
