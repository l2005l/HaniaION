from __future__ import annotations

import gzip
import json
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from requests.adapters import HTTPAdapter
try:
    from pywebpush import WebPushException, webpush
except ImportError:  # The main RAAM application can still run before push dependencies are installed.
    WebPushException = Exception
    webpush = None
from urllib3.util.retry import Retry

from satellite_service import build_coverage

from database import (
    DATABASE_ENABLED,
    database_status,
    get_history,
    get_monitor_state,
    initialize_database,
    save_raam_result,
    set_state_values,
    upsert_push_subscription,
    remove_push_subscription,
    list_push_subscriptions,
    mark_push_success,
    delete_push_subscription_by_id,
    push_subscription_count,
    add_monitor_log,
    get_monitor_logs,
    get_admin_statistics,
    save_gnss_sample,
    get_gnss_region,
)


APP_NAME = "HaniaION RAAM"
CDDIS_BASE = "https://cddis.nasa.gov/archive/gnss/data/daily"
EARTHDATA_HOST = "urs.earthdata.nasa.gov"
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "").replace("\\n", "\n").strip()
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com").strip()
CRON_SECRET = os.getenv("CRON_SECRET", "").strip()
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "").strip()
APP_VERSION = os.getenv("APP_VERSION", "1.0.0").strip()

app = FastAPI(title=APP_NAME)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.on_event("startup")
def startup_database() -> None:
    """Create the small monitoring schema when DATABASE_URL is configured."""
    initialize_database()

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




def discover_latest_brdc(session: EarthdataSession) -> dict[str, Any]:
    """Find the newest daily BRDC using a streamed request, without downloading its body."""
    today = datetime.now(timezone.utc).date()
    errors: list[str] = []
    for offset in range(7):
        target_day = today - timedelta(days=offset)
        base_url = directory_url(target_day)
        for file_name in candidate_file_names(target_day):
            response = None
            try:
                response = session.get(base_url + file_name, timeout=(20, 60), allow_redirects=True, stream=True)
                if response.status_code == 404:
                    continue
                response.raise_for_status()
                content_type = response.headers.get("Content-Type", "").lower()
                if "text/html" in content_type:
                    continue
                fingerprint = "|".join([
                    response.headers.get("ETag", ""),
                    response.headers.get("Last-Modified", ""),
                    response.headers.get("Content-Length", ""),
                ])
                return {"file_name": file_name, "source_day": target_day, "fingerprint": fingerprint, "url": base_url + file_name}
            except requests.RequestException as error:
                errors.append(f"{file_name}: {error}")
            finally:
                if response is not None:
                    response.close()
    raise RuntimeError("לא נמצא קובץ BRDC זמין בשבעת הימים האחרונים." + (f" {errors[-1]}" if errors else ""))


def send_push_to_all(payload: dict[str, Any]) -> dict[str, int]:
    if webpush is None or not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        return {"sent": 0, "failed": 0, "removed": 0}
    stats = {"sent": 0, "failed": 0, "removed": 0}
    data = json.dumps(payload, ensure_ascii=False)
    for subscription in list_push_subscriptions():
        try:
            webpush(
                subscription_info={"endpoint": subscription["endpoint"], "keys": subscription["keys"]},
                data=data,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
                ttl=3600,
            )
            mark_push_success(subscription["id"])
            stats["sent"] += 1
        except WebPushException as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            if status in (404, 410):
                delete_push_subscription_by_id(subscription["id"])
                stats["removed"] += 1
            else:
                stats["failed"] += 1
    return stats



def require_admin(x_admin_secret: str | None) -> None:
    if not ADMIN_SECRET:
        raise HTTPException(status_code=503, detail="ADMIN_SECRET is not configured")
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

def next_scheduled_check(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    next_hour = ((now.hour // 3) + 1) * 3
    day = now.date()
    if next_hour >= 24:
        next_hour = 0
        day += timedelta(days=1)
    return datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc).replace(hour=next_hour).isoformat()


def run_monitor() -> dict[str, Any]:
    if not DATABASE_ENABLED:
        raise RuntimeError("DATABASE_URL is required for automatic monitoring")
    started = datetime.now(timezone.utc)
    add_monitor_log("info", "monitor_started", "Automatic BRDC check started")
    set_state_values({"monitor_status": "checking", "last_monitor_started_at": started.isoformat()})
    try:
        session = create_session()
        remote = discover_latest_brdc(session)
        state = get_monitor_state()
        same_file = state.get("last_remote_file_name") == remote["file_name"]
        same_fingerprint = bool(remote["fingerprint"]) and state.get("last_remote_fingerprint") == remote["fingerprint"]

        if same_file and (same_fingerprint or not remote["fingerprint"]):
            finished = datetime.now(timezone.utc)
            set_state_values({
                "monitor_status": "idle", "last_check_at": finished.isoformat(),
                "last_monitor_result": "no_new_file", "last_remote_file_name": remote["file_name"],
                "last_remote_fingerprint": remote["fingerprint"],
            })
            add_monitor_log("info", "monitor_no_change", f"No new BRDC file: {remote['file_name']}", duration_ms=int((finished-started).total_seconds()*1000))
            return {"ok": True, "action": "no_new_file", "file_name": remote["file_name"], "checked_at": finished.isoformat()}

        # A new name, or a silent replacement with changed HTTP metadata, triggers the full download and parse.
        with _cache_lock:
            _cache["result"] = None
            _cache["expires_at"] = 0.0
        result = calculate_latest()
        database_result = save_raam_result(result)
        is_baseline = not bool(state.get("last_remote_file_name"))
        should_notify = not is_baseline and result["file_name"] != state.get("last_remote_file_name")
        push = {"sent": 0, "failed": 0, "removed": 0}
        if should_notify:
            push = send_push_to_all({
                "title": "HaniaION — New BRDC file",
                "body": f"{result['file_name']} is now available. Tap to view RAAM data.",
                "url": "/#extractor",
                "tag": "haniaion-brdc-update",
                "data": {"file_name": result["file_name"], "source_date": result["source_date"]},
            })
        finished = datetime.now(timezone.utc)
        set_state_values({
            "monitor_status": "idle", "last_check_at": finished.isoformat(),
            "last_monitor_result": "new_file" if should_notify else "baseline",
            "last_remote_file_name": remote["file_name"], "last_remote_fingerprint": remote["fingerprint"],
            "last_notification_at": finished.isoformat() if should_notify else state.get("last_notification_at", ""),
            "last_push_stats": push,
        })
        event = "monitor_new_file" if should_notify else "monitor_baseline"
        add_monitor_log("info", event, f"Processed {result['file_name']}", {"push": push, "database": database_result}, int((finished-started).total_seconds()*1000))
        return {"ok": True, "action": "new_file" if should_notify else "baseline", "result": result, "database": database_result, "push": push}
    except Exception as error:
        failed_at = datetime.now(timezone.utc)
        set_state_values({"monitor_status": "error", "last_monitor_error": str(error)[:500], "last_check_at": failed_at.isoformat()})
        add_monitor_log("error", "monitor_error", str(error)[:500], duration_ms=int((failed_at-started).total_seconds()*1000))
        raise


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


@app.get("/satellite")
def satellite_page():
    return FileResponse("static/satellite.html")


@app.get("/api/satellites/coverage")
def satellite_coverage(minutes: int = Query(90, ge=15, le=360)):
    try:
        return build_coverage(minutes_ahead=minutes)
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Satellite source unavailable: {error}") from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Satellite calculation failed: {error}") from error


@app.get("/k69-embed", response_class=HTMLResponse)
def k69_embed():
    """Render the external K-69 monitor inside HaniaION without opening a new window."""
    try:
        response = requests.get(
            "https://k69.link/",
            timeout=(10, 25),
            headers={"User-Agent": "HaniaION-K69-Embed/1.0", "Accept": "text/html,*/*"},
        )
        response.raise_for_status()
        html = response.text
        # Resolve relative scripts, styles and images against the original site.
        if "<head" in html.lower():
            html = re.sub(r'(<head[^>]*>)', r'\1<base href="https://k69.link/">', html, count=1, flags=re.I)
        else:
            html = '<base href="https://k69.link/">' + html
        return HTMLResponse(
            html,
            headers={
                "Cache-Control": "no-store",
                "Content-Security-Policy": "default-src 'self' https://k69.link data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://k69.link wss://k69.link; img-src 'self' https://k69.link data: blob:; frame-ancestors 'self'",
            },
        )
    except requests.RequestException as error:
        return HTMLResponse(
            """<!doctype html><html lang='he' dir='rtl'><meta charset='utf-8'><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#17324a;font-family:Arial,sans-serif;text-align:center;padding:24px;box-sizing:border-box}strong{font-size:1.15rem}p{color:#64748b}</style><body><div><strong>תצוגת K-69 אינה זמינה כרגע</strong><p>נסה לטעון מחדש בעוד מספר שניות.</p></div></body></html>""",
            status_code=502,
            headers={"Cache-Control": "no-store"},
        )


@app.get("/admin")
def admin_page():
    return FileResponse("static/admin.html")


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
    db = database_status()
    return {
        "status": "ok" if (not db["enabled"] or db["connected"]) else "degraded",
        "database": db,
    }


@app.get("/api/history")
def history(limit: int = Query(default=30, ge=1, le=100)):
    return {
        "database_enabled": DATABASE_ENABLED,
        "count": len(items := get_history(limit)),
        "items": items,
    }



@app.post("/api/gnss/sample")
async def gnss_sample(request: Request):
    payload = await request.json()
    try:
        save_gnss_sample(payload["lat_cell"], payload["lon_cell"], payload["score"], payload["accuracy_m"], payload["fix_ratio"])
        return {"ok": True}
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="invalid GNSS sample")

@app.get("/api/gnss/region")
def gnss_region(lat_cell: float = Query(...), lon_cell: float = Query(...)):
    return get_gnss_region(lat_cell, lon_cell)

@app.get("/api/monitor/status")
def monitor_status():
    return {
        "database": database_status(),
        "state": get_monitor_state(),
        "schedule": "Every 3 hours via GitHub Actions",
        "next_check_at": next_scheduled_check(),
        "version": APP_VERSION,
        "push": {"configured": bool(webpush and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY), "subscribers": push_subscription_count() if DATABASE_ENABLED else 0},
    }


@app.get("/api/admin/overview")
def admin_overview(x_admin_secret: str | None = Header(default=None)):
    require_admin(x_admin_secret)
    return {
        "version": APP_VERSION, "database": database_status(), "state": get_monitor_state(),
        "statistics": get_admin_statistics(), "next_check_at": next_scheduled_check(),
        "push_configured": bool(webpush and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY),
        "cron_configured": bool(CRON_SECRET),
    }

@app.get("/api/admin/logs")
def admin_logs(limit: int = Query(default=100, ge=1, le=500), x_admin_secret: str | None = Header(default=None)):
    require_admin(x_admin_secret)
    return {"items": get_monitor_logs(limit)}

@app.post("/api/admin/run-now")
def admin_run_now(x_admin_secret: str | None = Header(default=None)):
    require_admin(x_admin_secret)
    try:
        return run_monitor()
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

@app.post("/api/admin/test-push")
def admin_test_push(x_admin_secret: str | None = Header(default=None)):
    require_admin(x_admin_secret)
    stats = send_push_to_all({
        "title": "HaniaION test notification",
        "body": "Push notifications are configured correctly.",
        "url": "/admin", "tag": "haniaion-test",
    })
    add_monitor_log("info", "test_push", "Admin sent a test push", stats)
    return {"ok": True, "push": stats}


@app.get("/api/push/public-key")
def push_public_key():
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push notifications are not configured")
    return {"public_key": VAPID_PUBLIC_KEY}


@app.post("/api/push/subscribe")
async def push_subscribe(request: Request):
    body = await request.json()
    try:
        upsert_push_subscription(body, request.headers.get("user-agent"))
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"ok": True}


@app.post("/api/push/unsubscribe")
async def push_unsubscribe(request: Request):
    body = await request.json()
    endpoint = str(body.get("endpoint", "")).strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="Missing endpoint")
    return {"ok": True, "removed": remove_push_subscription(endpoint)}


@app.post("/api/monitor/run")
def monitor_run(authorization: str | None = Header(default=None)):
    if not CRON_SECRET:
        raise HTTPException(status_code=503, detail="CRON_SECRET is not configured")
    if authorization != f"Bearer {CRON_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        return run_monitor()
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.post("/api/calculate")
def calculate(request: Request):
    client_ip = (
        request.client.host
        if request.client
        else "unknown"
    )

    check_rate_limit(client_ip)

    try:
        result = calculate_latest()
        try:
            result["database"] = save_raam_result(result)
        except Exception as database_error:
            # Extraction must keep working even if the external database is temporarily unavailable.
            result["database"] = {
                "saved": False,
                "reason": "database_error",
                "message": str(database_error)[:240],
            }
        return result

    except requests.Timeout as error:
        with _cache_lock:
            stale = dict(_cache["result"]) if _cache["result"] is not None else None
        if stale:
            stale.update(cached=True, stale=True, stale_reason="החיבור ל-CDDIS ארך יותר מדי זמן; מוצגים הנתונים האחרונים שנשמרו בשרת.")
            return stale
        raise HTTPException(status_code=504, detail="החיבור ל-CDDIS ארך יותר מדי זמן ואין נתונים שמורים.") from error

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
