from __future__ import annotations

import gzip
import json
import math
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from requests.adapters import HTTPAdapter
try:
    from pywebpush import WebPushException, webpush
    from py_vapid import Vapid
except ImportError:  # The main RAAM application can still run before push dependencies are installed.
    WebPushException = Exception
    webpush = None
    Vapid = None
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
    get_push_subscription,
    set_push_preferences,
    get_push_preferences,
    replace_k69_alert_schedule,
    get_k69_schedule_ids,
    mark_k69_alerts_armed,
    due_k69_alerts,
    mark_k69_alert_sent,
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
VAPID_PRIVATE_KEY_RAW = os.getenv("VAPID_PRIVATE_KEY", "").replace("\\n", "\n").strip()
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com").strip()


def _normalize_vapid_private_key(value: str) -> tuple[str, str | None]:
    """Normalize VAPID private keys into an unencrypted PKCS8 PEM.

    Accepted inputs:
      * PKCS8 PEM (real newlines or literal ``\\n``)
      * SEC1/EC PRIVATE KEY PEM
      * base64/base64url encoded DER
      * base64/base64url encoded raw 32-byte P-256 scalar

    Some hosting dashboards preserve PEM wrappers/line breaks differently,
    so the parser deliberately tries the actual PEM first and then falls
    back to decoding the material inside the wrappers.
    """
    import base64

    if not value:
        return "", "VAPID private key is missing"

    # Normalize the common Render/dashboard representation.
    normalized = value.strip().replace("\\r", "").replace("\\n", "\n")
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n").strip()

    def pem_from_key(key) -> tuple[str, str | None]:
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            return "", "VAPID private key is not an EC private key"
        if key.curve.name != "secp256r1":
            return "", "VAPID private key is not an EC P-256 key"
        pem = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii").strip()
        return pem, None

    # 1) Try the supplied PEM exactly as-is.
    if "BEGIN" in normalized and "PRIVATE KEY" in normalized:
        try:
            key = serialization.load_pem_private_key(
                normalized.encode("utf-8"), password=None
            )
            return pem_from_key(key)
        except Exception:
            # Do not stop here. A user may have wrapped a raw/DER key in
            # PEM headers, or a dashboard may have altered whitespace.
            pass

        # 2) Strip any PEM wrapper and try the enclosed base64 material.
        body = re.sub(
            r"-----BEGIN [^-]+-----|-----END [^-]+-----",
            "",
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = "".join(body.split())

    # 3) Decode base64/base64url. This covers PKCS8 DER and raw 32-byte scalar.
    if normalized:
        padded = normalized + "=" * (-len(normalized) % 4)
        decoded_candidates = []
        for decoder in (base64.urlsafe_b64decode, base64.b64decode):
            try:
                raw = decoder(padded.encode("ascii"))
                if raw not in decoded_candidates:
                    decoded_candidates.append(raw)
            except Exception:
                continue

        for raw in decoded_candidates:
            # PKCS8 / SEC1 DER
            try:
                key = serialization.load_der_private_key(raw, password=None)
                pem, err = pem_from_key(key)
                if not err:
                    return pem, None
            except Exception:
                pass

            # Raw 32-byte P-256 private scalar
            if len(raw) == 32:
                scalar = int.from_bytes(raw, "big")
                try:
                    key = ec.derive_private_key(
                        scalar, ec.SECP256R1(), default_backend()
                    )
                    return pem_from_key(key)
                except Exception:
                    pass

    return "", "VAPID private key format is invalid"


def _validate_vapid_pair(public_key: str, private_pem: str) -> tuple[bool, str]:
    """Validate that public and private VAPID keys are a matching P-256 pair."""
    if not public_key:
        return False, "VAPID public key is missing"
    if not private_pem:
        return False, "VAPID private key is missing or invalid"
    try:
        import base64
        compact = public_key + "=" * (-len(public_key) % 4)
        public_bytes = base64.urlsafe_b64decode(compact.encode("ascii"))
        if len(public_bytes) != 65 or public_bytes[0] != 4:
            return False, "VAPID public key is not a 65-byte uncompressed P-256 key"
        key = serialization.load_pem_private_key(private_pem.encode("ascii"), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey) or key.curve.name != "secp256r1":
            return False, "VAPID private key is not P-256"
        derived = key.public_key().public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        if derived != public_bytes:
            return False, "VAPID Public and Private keys do not match"
        return True, "VAPID P-256 key pair is valid"
    except Exception as exc:
        return False, f"VAPID key validation failed: {type(exc).__name__}"


VAPID_PRIVATE_KEY, VAPID_KEY_ERROR = _normalize_vapid_private_key(VAPID_PRIVATE_KEY_RAW)
VAPID_KEY_VALID, VAPID_KEY_STATUS = _validate_vapid_pair(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)


def _create_vapid_signer():
    """Load the normalized PEM once instead of passing PEM text as base64url.

    pywebpush treats a string argument as a raw/base64url key. Passing PEM text
    through that path raises a decoding exception before a Push request is sent.
    """
    if not VAPID_KEY_VALID or Vapid is None:
        return None
    try:
        return Vapid.from_pem(VAPID_PRIVATE_KEY.encode("ascii"))
    except Exception:
        return None


VAPID_SIGNER = _create_vapid_signer()
if VAPID_KEY_VALID and VAPID_SIGNER is None:
    VAPID_KEY_VALID = False
    VAPID_KEY_STATUS = "VAPID private key could not be loaded by pywebpush"
CRON_SECRET = os.getenv("CRON_SECRET", "").strip()
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "").strip()
APP_VERSION = os.getenv("APP_VERSION", "3.3.2").strip()

app = FastAPI(title=APP_NAME)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.on_event("startup")
def startup_database() -> None:
    """Create the small monitoring schema and start the K-69 scheduler."""
    initialize_database()
    if DATABASE_ENABLED and webpush is not None and VAPID_KEY_VALID:
        worker = threading.Thread(target=k69_alert_worker, name="k69-alert-worker", daemon=True)
        worker.start()

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
    if webpush is None or not VAPID_KEY_VALID:
        return {"sent": 0, "failed": 0, "removed": 0}
    stats = {"sent": 0, "failed": 0, "removed": 0}
    data = json.dumps(payload, ensure_ascii=False)
    category = str((payload.get("data") or {}).get("category", "")).strip().lower()
    for subscription in list_push_subscriptions():
        if category == "nasa" and not subscription.get("nasa_enabled", True):
            continue
        if category == "k69" and not subscription.get("k69_enabled", True):
            continue
        try:
            webpush(
                subscription_info={"endpoint": subscription["endpoint"], "keys": subscription["keys"]},
                data=data,
                vapid_private_key=VAPID_SIGNER,
                vapid_claims={"sub": VAPID_SUBJECT},
                ttl=3600,
            )
            mark_push_success(subscription["id"])
            stats["sent"] += 1
        except Exception as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            if status in (404, 410):
                delete_push_subscription_by_id(subscription["id"])
                stats["removed"] += 1
            else:
                stats["failed"] += 1
    return stats



def process_k69_alerts_once() -> None:
    """Deliver due K-69 alerts for the cycle explicitly scheduled by a user."""
    if not DATABASE_ENABLED or webpush is None or not VAPID_KEY_VALID:
        return
    for item in due_k69_alerts():
        seconds = int(item["seconds_before"])
        if seconds == 0:
            body = "K הגיע עכשיו 🔔"
        elif seconds == 1:
            body = "בעוד שנייה יגיע המפתח 🔔"
        else:
            body = f"בעוד {seconds} שניות יגיע המפתח 🔔"
        stats = send_push_to_all_for_endpoints(
            [item["endpoint"]],
            {
                "title": "HaniaION — התראת K-69",
                "body": body,
                "url": "/#k69-live-target",
                "tag": f"haniaion-k69-{item['cycle_at'].isoformat()}-{seconds}",
                "data": {
                    "category": "k69",
                    "type": "k69-alert",
                    "cycle_at": item["cycle_at"].isoformat(),
                    "seconds_before": seconds,
                },
            },
        )
        if stats["sent"] > 0:
            mark_k69_alert_sent(item["id"])
            add_monitor_log(
                "info",
                "k69_alert_sent",
                f"K69 alert {seconds}s before cycle",
                {"push": stats, "cycle_at": item["cycle_at"].isoformat()},
            )
        else:
            add_monitor_log(
                "error",
                "k69_alert_delivery_failed",
                f"K69 alert {seconds}s before cycle was not delivered",
                {"push": stats, "cycle_at": item["cycle_at"].isoformat()},
            )


def k69_alert_worker() -> None:
    """Best-effort one-second scheduler while the web process is alive."""
    while True:
        try:
            process_k69_alerts_once()
        except Exception as error:
            add_monitor_log("error", "k69_alert_worker_error", str(error)[:500])
        time.sleep(1)


def send_push_to_all_for_endpoints(endpoints: list[str], payload: dict[str, Any]) -> dict[str, int]:
    if webpush is None or not VAPID_KEY_VALID:
        return {"sent": 0, "failed": 0, "removed": 0}
    wanted = set(endpoints)
    stats = {"sent": 0, "failed": 0, "removed": 0}
    data = json.dumps(payload, ensure_ascii=False)
    category = str((payload.get("data") or {}).get("category", "")).strip().lower()
    for subscription in list_push_subscriptions():
        if subscription["endpoint"] not in wanted:
            continue
        if category == "nasa" and not subscription.get("nasa_enabled", True):
            continue
        if category == "k69" and not subscription.get("k69_enabled", True):
            continue
        try:
            webpush(
                subscription_info={"endpoint": subscription["endpoint"], "keys": subscription["keys"]},
                data=data,
                vapid_private_key=VAPID_SIGNER,
                vapid_claims={"sub": VAPID_SUBJECT},
                ttl=120,
            )
            mark_push_success(subscription["id"])
            stats["sent"] += 1
        except Exception as error:
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
                "data": {"category": "nasa", "file_name": result["file_name"], "source_date": result["source_date"]},
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


_iss_lock = threading.Lock()
_iss_cache: dict[str, Any] = {"expires": 0.0, "value": None}


@app.get("/api/satellites/iss")
def iss_live_position():
    """Server-side HTTPS feed shared by the website and Android app."""
    now = time.time()
    with _iss_lock:
        if _iss_cache["value"] and now < _iss_cache["expires"]:
            return _iss_cache["value"]
    try:
        response = requests.get(
            "https://api.wheretheiss.at/v1/satellites/25544",
            timeout=(5, 12),
            headers={"User-Agent": "HaniaION-ISS/3.3", "Accept": "application/json"},
        )
        response.raise_for_status()
        raw = response.json()
        lat, lon = float(raw["latitude"]), float(raw["longitude"])
        lat1, lat2 = math.radians(31.5), math.radians(lat)
        dlat, dlon = lat2 - lat1, math.radians(lon - 34.8)
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        distance = 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))
        value = {
            "available": True,
            "latitude": lat,
            "longitude": lon,
            "altitude_km": round(float(raw.get("altitude", 0.0)), 1),
            "velocity_kmh": round(float(raw.get("velocity", 0.0))),
            "visibility": raw.get("visibility", "unknown"),
            "distance_from_israel_km": round(distance),
            "timestamp": datetime.fromtimestamp(float(raw.get("timestamp", now)), timezone.utc).isoformat(),
        }
        with _iss_lock:
            _iss_cache.update(value=value, expires=now + 8)
        return value
    except Exception as error:
        with _iss_lock:
            cached = _iss_cache.get("value")
        if cached:
            return {**cached, "available": False, "cached": True}
        raise HTTPException(status_code=502, detail=f"ISS position unavailable: {error}") from error


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




@app.get("/vapid-generator")
def vapid_generator():
    """Local browser-side VAPID key generator; keys never leave the device."""
    return FileResponse("static/vapid-generator.html")


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
        "push": {"configured": bool(webpush and VAPID_KEY_VALID), "subscribers": push_subscription_count() if DATABASE_ENABLED else 0},
    }


@app.get("/api/admin/overview")
def admin_overview(x_admin_secret: str | None = Header(default=None)):
    require_admin(x_admin_secret)
    return {
        "version": APP_VERSION, "database": database_status(), "state": get_monitor_state(),
        "statistics": get_admin_statistics(), "next_check_at": next_scheduled_check(),
        "push_configured": bool(webpush and VAPID_KEY_VALID),
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


@app.get("/api/push/preferences")
def push_preferences(request: Request):
    endpoint = str(request.query_params.get("endpoint", "")).strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="Missing endpoint")
    prefs = get_push_preferences(endpoint)
    if prefs is None:
        raise HTTPException(status_code=404, detail="Push subscription not found")
    return {"ok": True, **prefs}


@app.post("/api/push/preferences")
async def update_push_preferences(request: Request):
    body = await request.json()
    endpoint = str(body.get("endpoint", "")).strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="Missing endpoint")
    nasa = body.get("nasa_enabled")
    k69 = body.get("k69_enabled")
    if nasa is None and k69 is None:
        raise HTTPException(status_code=400, detail="No preference supplied")
    if nasa is not None and not isinstance(nasa, bool):
        raise HTTPException(status_code=400, detail="nasa_enabled must be boolean")
    if k69 is not None and not isinstance(k69, bool):
        raise HTTPException(status_code=400, detail="k69_enabled must be boolean")
    if not set_push_preferences(endpoint, nasa_enabled=nasa, k69_enabled=k69):
        raise HTTPException(status_code=404, detail="Push subscription not found")
    return {"ok": True, **(get_push_preferences(endpoint) or {})}


@app.post("/api/k69/schedule")
async def schedule_k69_alerts(request: Request):
    """Schedule selected alerts for one specific K-69 cycle."""
    if not DATABASE_ENABLED:
        raise HTTPException(status_code=503, detail="DATABASE_URL is required for background K-69 alerts")
    if webpush is None or not VAPID_KEY_VALID:
        raise HTTPException(status_code=503, detail=f"Push notifications are not configured: {VAPID_KEY_STATUS}")

    body = await request.json()
    endpoint = str(body.get("endpoint", "")).strip()
    cycle_raw = str(body.get("cycle_at", "")).strip()
    selected = body.get("seconds_before", [])
    if not endpoint or not cycle_raw or not isinstance(selected, list):
        raise HTTPException(status_code=400, detail="Missing endpoint, cycle_at or seconds_before")

    allowed = {0, 10, 30, 60}
    try:
        seconds_before = sorted({int(value) for value in selected if int(value) in allowed}, reverse=True)
        cycle_at = datetime.fromisoformat(cycle_raw.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid K-69 schedule") from None

    if not seconds_before:
        raise HTTPException(status_code=400, detail="Select at least one alert")
    if cycle_at <= datetime.now(timezone.utc) - timedelta(seconds=5):
        raise HTTPException(status_code=400, detail="This K-69 cycle has already started")
    if cycle_at > datetime.now(timezone.utc) + timedelta(minutes=20):
        raise HTTPException(status_code=400, detail="Only the next K-69 cycle can be scheduled")

    if get_push_subscription(endpoint) is None:
        raise HTTPException(status_code=404, detail="Push subscription not found; enable notifications first")

    count = replace_k69_alert_schedule(endpoint, cycle_at, seconds_before)
    schedule_ids = get_k69_schedule_ids(endpoint, cycle_at)

    # Arm the phone immediately. This is the important Free-tier path:
    # Render does not need to stay awake until 10/30/60 seconds before K.
    # The service worker receives this one push while the server is awake and
    # owns the short countdown for this specific K cycle.
    arm_alerts = [
        {
            "schedule_id": schedule_id,
            "seconds_before": seconds,
            "due_at": (cycle_at - timedelta(seconds=seconds)).isoformat(),
        }
        for schedule_id, seconds in zip(schedule_ids, sorted(seconds_before, reverse=True))
    ]
    arm_stats = send_push_to_all_for_endpoints(
        [endpoint],
        {
            "title": "HaniaION — תזמון K-69",
            "body": "ההתראות למחזור K הבא הופעלו בטלפון.",
            "url": "/#k69-live-target",
            "tag": f"haniaion-k69-arm-{cycle_at.isoformat()}",
            "data": {
                "category": "k69",
                "type": "k69-arm",
                "cycle_at": cycle_at.isoformat(),
                "alerts": arm_alerts,
            },
        },
    )

    if arm_stats["sent"] == 0:
        add_monitor_log("error", "k69_arm_push_failed", "K69 schedule was saved but the arm Push could not be delivered", {"push": arm_stats})
        raise HTTPException(
            status_code=502,
            detail="המחזור נשמר, אבל לא ניתן היה לשלוח את פקודת ההפעלה לטלפון. בדוק את מפתחות VAPID ואת שירות ה-Push.",
        )

    return {
        "ok": True,
        "cycle_at": cycle_at.isoformat(),
        "scheduled": count,
        "seconds_before": seconds_before,
        "background": True,
        "arm_push_sent": arm_stats["sent"] > 0,
        "arm_push": arm_stats,
    }


@app.post("/api/k69/arm-ack")
async def k69_arm_ack(request: Request):
    """Acknowledge that the device received and armed a K-69 background schedule."""
    if not DATABASE_ENABLED:
        raise HTTPException(status_code=503, detail="DATABASE_URL is required")
    body = await request.json()
    endpoint = str(body.get("endpoint", "")).strip()
    raw_ids = body.get("schedule_ids", [])
    if not endpoint or not isinstance(raw_ids, list):
        raise HTTPException(status_code=400, detail="Missing endpoint or schedule_ids")
    try:
        schedule_ids = [int(value) for value in raw_ids]
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid schedule_ids") from None
    armed = mark_k69_alerts_armed(endpoint, schedule_ids)
    return {"ok": True, "armed": armed}


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

@app.get("/api/push/diagnostics")
def push_diagnostics():
    """Return safe, non-secret Push diagnostics for the current deployment."""
    db = database_status()
    has_public = bool(VAPID_PUBLIC_KEY)
    has_private = bool(VAPID_PRIVATE_KEY)
    webpush_loaded = webpush is not None
    configured = bool(DATABASE_ENABLED and webpush_loaded and VAPID_KEY_VALID)
    subscribers = push_subscription_count() if DATABASE_ENABLED else 0
    due = len(due_k69_alerts()) if DATABASE_ENABLED else 0
    return {
        "ok": configured and db.get("connected", False),
        "database": {
            "enabled": bool(db.get("enabled")),
            "connected": bool(db.get("connected")),
            "message": db.get("message"),
        },
        "push": {
            "pywebpush_loaded": webpush_loaded,
            "vapid_public_key_present": has_public,
            "vapid_private_key_present": has_private,
            "vapid_subject_present": bool(VAPID_SUBJECT),
            "vapid_key_valid": bool(VAPID_KEY_VALID),
            "vapid_key_status": VAPID_KEY_STATUS,
            "configured": bool(webpush_loaded and VAPID_KEY_VALID),
            "subscribers": subscribers,
        },
        "k69": {
            "worker_should_start": configured,
            "due_unsent_now": due,
        },
        "server_time_utc": datetime.now(timezone.utc).isoformat(),
        "version": APP_VERSION,
    }


@app.post("/api/k69/process-due")
def k69_process_due(authorization: str | None = Header(default=None)):
    """Process due K-69 Push alerts; intended for an external cron/uptime scheduler."""
    if not CRON_SECRET:
        raise HTTPException(status_code=503, detail="CRON_SECRET is not configured")
    if authorization != f"Bearer {CRON_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not DATABASE_ENABLED:
        raise HTTPException(status_code=503, detail="DATABASE_URL is not configured")
    if webpush is None or not VAPID_KEY_VALID:
        raise HTTPException(status_code=503, detail=f"Push notifications are not configured: {VAPID_KEY_STATUS}")
    before = len(due_k69_alerts())
    process_k69_alerts_once()
    after = len(due_k69_alerts())
    return {"ok": True, "processed": max(0, before - after), "remaining_due": after, "server_time_utc": datetime.now(timezone.utc).isoformat()}
