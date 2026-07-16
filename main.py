from __future__ import annotations

import asyncio
import gzip
import re
from datetime import date
from typing import Callable
from urllib.parse import urlparse

import flet as ft
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


APP_TITLE = "Ionosphere Data Extractor for RAAM"
CURRENT_YEAR = date.today().year
URL_PATH = f"https://cddis.nasa.gov/archive/gnss/data/daily/{CURRENT_YEAR}/brdc/"


class EarthdataSession(requests.Session):
    AUTH_HOST = "urs.earthdata.nasa.gov"

    def rebuild_auth(self, prepared_request, response):
        headers = prepared_request.headers
        if "Authorization" not in headers:
            return

        original = urlparse(response.request.url)
        redirected = urlparse(prepared_request.url)

        if (
            original.hostname != redirected.hostname
            and redirected.hostname != self.AUTH_HOST
            and original.hostname != self.AUTH_HOST
        ):
            del headers["Authorization"]


def create_session(username: str, password: str) -> EarthdataSession:
    session = EarthdataSession()

    retry_strategy = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )

    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)

    if username and password:
        session.auth = (username, password)

    session.headers.update(
        {
            "User-Agent": "IonosphereRAAM/1.0 (Python requests; CDDIS data client)"
        }
    )

    return session


def find_most_recent_brdc_link(html: str) -> str:
    links = re.findall(
        r'href=["\'](brdc[^"\']+\.gz)["\']',
        html,
        flags=re.IGNORECASE,
    )

    if not links:
        lowered = html.lower()
        if "earthdata login" in lowered or "urs.earthdata.nasa.gov" in lowered:
            raise RuntimeError(
                "התקבל דף התחברות של Earthdata במקום רשימת קבצים.\n"
                "יש להזין שם משתמש וסיסמה תקינים."
            )

        raise RuntimeError(
            "לא נמצאו קובצי BRDC מסוג GZIP בדף שהתקבל.\n"
            "ייתכן שהשרת עמוס או שהגישה ל-CDDIS טרם אושרה."
        )

    return sorted(set(link.strip() for link in links))[-1]


def parse_klobuchar(rinex_text: str) -> dict:
    alpha = []
    beta = []
    leap_seconds = None

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
        raise ValueError("לא נמצאו ארבעה ערכי Klobuchar Alpha.")
    if len(beta) != 4:
        raise ValueError("לא נמצאו ארבעה ערכי Klobuchar Beta.")
    if leap_seconds is None:
        raise ValueError("לא נמצא ערך LEAP SECONDS.")

    return {
        "alpha": alpha,
        "beta": beta,
        "leap_seconds": leap_seconds,
    }


def format_for_raam(klob_data: dict) -> dict:
    alpha = klob_data["alpha"].copy()
    beta = klob_data["beta"].copy()
    tls = klob_data["leap_seconds"]

    alpha[0] *= 2**30
    alpha[1] *= 2**27
    alpha[2] *= 2**24
    alpha[3] *= 2**24

    beta[0] /= 2**11
    beta[1] /= 2**14
    beta[2] /= 2**16
    beta[3] /= 2**16

    alpha = [round(value) for value in alpha]
    beta = [round(value) for value in beta]

    alpha_bytes = [value & 0xFF for value in alpha]
    beta_bytes = [value & 0xFF for value in beta]

    return {
        "alpha01": (alpha_bytes[0] << 8) | alpha_bytes[1],
        "alpha02": (alpha_bytes[2] << 8) | alpha_bytes[3],
        "beta01": (beta_bytes[0] << 8) | beta_bytes[1],
        "beta02": (beta_bytes[2] << 8) | beta_bytes[3],
        "tLS": tls,
    }


def download_and_process(
    username: str,
    password: str,
    status_callback: Callable[[str], None],
    progress_callback: Callable[[float | None], None],
) -> dict:
    session = create_session(username, password)

    status_callback("מתחבר לארכיון CDDIS...")
    progress_callback(None)

    directory_response = session.get(URL_PATH, timeout=(20, 180))
    directory_response.raise_for_status()

    file_name = find_most_recent_brdc_link(directory_response.text)
    file_url = URL_PATH + file_name

    status_callback(f"מוריד את הקובץ: {file_name}")
    progress_callback(0)

    file_response = session.get(
        file_url,
        stream=True,
        timeout=(20, 300),
    )
    file_response.raise_for_status()

    content_type = file_response.headers.get("Content-Type", "").lower()
    if "text/html" in content_type:
        raise RuntimeError(
            "התקבל דף HTML במקום קובץ BRDC.\n"
            "בדוק את פרטי Earthdata ואת אישור הגישה ל-CDDIS."
        )

    total_size = int(file_response.headers.get("Content-Length", "0") or 0)
    downloaded = 0
    compressed_data = bytearray()

    if total_size <= 0:
        progress_callback(None)

    for chunk in file_response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue

        compressed_data.extend(chunk)
        downloaded += len(chunk)

        if total_size > 0:
            progress_callback(min(1.0, downloaded / total_size))

    if len(compressed_data) < 100:
        raise RuntimeError("הקובץ שהורד ריק או קטן מדי.")

    if compressed_data[:2] != b"\x1f\x8b":
        raise RuntimeError(
            "הקובץ שהתקבל אינו קובץ GZIP תקין.\n"
            "ייתכן שהתקבל דף התחברות במקום קובץ הנתונים."
        )

    status_callback("מחלץ את קובץ ה-GZIP...")
    progress_callback(None)

    try:
        decompressed = gzip.decompress(bytes(compressed_data))
    except (gzip.BadGzipFile, EOFError) as error:
        raise RuntimeError(
            "קובץ ה-BRDC פגום או שההורדה לא הושלמה."
        ) from error

    status_callback("קורא את נתוני Klobuchar...")
    rinex_text = decompressed.decode("ascii", errors="replace")
    klob_data = parse_klobuchar(rinex_text)

    status_callback("מחשב את נתוני RAAM...")
    raam_data = format_for_raam(klob_data)

    progress_callback(1.0)

    return {
        "file_name": file_name,
        "klob": klob_data,
        "raam": raam_data,
    }


def main(page: ft.Page):
    page.title = APP_TITLE
    page.padding = 0
    page.scroll = ft.ScrollMode.AUTO
    page.theme_mode = ft.ThemeMode.LIGHT

    title = ft.Text(
        "Ionosphere Data Extractor",
        size=28,
        weight=ft.FontWeight.BOLD,
        text_align=ft.TextAlign.CENTER,
    )

    subtitle = ft.Text(
        "Klobuchar data conversion for RAAM",
        text_align=ft.TextAlign.CENTER,
    )

    username_field = ft.TextField(
        label="Earthdata username",
        expand=True,
    )

    password_field = ft.TextField(
        label="Earthdata password",
        password=True,
        can_reveal_password=True,
        expand=True,
    )

    note = ft.Text(
        "בגרסת האינטרנט יש להזין פרטי Earthdata בכל הפעלה. "
        "הפרטים אינם נשמרים בקוד או בקובץ.",
        size=12,
        color=ft.Colors.GREY_700,
        text_align=ft.TextAlign.CENTER,
    )

    status_text = ft.Text("מוכן.", text_align=ft.TextAlign.CENTER)
    progress_bar = ft.ProgressBar(value=0)
    progress_text = ft.Text("0%", text_align=ft.TextAlign.CENTER)

    result_file = ft.Text("-")
    result_alpha = ft.Text("-", selectable=True)
    result_beta = ft.Text("-", selectable=True)
    result_data1 = ft.Text("-", selectable=True)
    result_data2 = ft.Text("-", selectable=True)
    result_data3 = ft.Text("-", selectable=True)
    result_data4 = ft.Text("-", selectable=True)
    result_tls = ft.Text("-", selectable=True)

    def result_row(label: str, value_control: ft.Control):
        return ft.ResponsiveRow(
            controls=[
                ft.Container(
                    content=ft.Text(label, weight=ft.FontWeight.BOLD),
                    col={"xs": 12, "sm": 4},
                ),
                ft.Container(
                    content=value_control,
                    col={"xs": 12, "sm": 8},
                ),
            ]
        )

    def show_message(message: str):
        page.show_dialog(ft.SnackBar(content=ft.Text(message)))

    def set_status(message: str):
        status_text.value = message
        page.update()

    def set_progress(value: float | None):
        progress_bar.value = value
        progress_text.value = "טוען..." if value is None else f"{value * 100:.0f}%"
        page.update()

    async def start_download(_):
        username = (username_field.value or "").strip()
        password = password_field.value or ""

        if not username or not password:
            show_message("יש להזין שם משתמש וסיסמה של Earthdata.")
            return

        download_button.disabled = True
        progress_bar.value = None
        progress_text.value = "טוען..."
        status_text.value = "מתחיל..."
        page.update()

        loop = asyncio.get_running_loop()

        def safe_status(message: str):
            loop.call_soon_threadsafe(set_status, message)

        def safe_progress(value: float | None):
            loop.call_soon_threadsafe(set_progress, value)

        try:
            result = await asyncio.to_thread(
                download_and_process,
                username,
                password,
                safe_status,
                safe_progress,
            )

            klob = result["klob"]
            raam = result["raam"]

            result_file.value = result["file_name"]
            result_alpha.value = ", ".join(str(v) for v in klob["alpha"])
            result_beta.value = ", ".join(str(v) for v in klob["beta"])
            result_data1.value = str(raam["alpha01"])
            result_data2.value = str(raam["alpha02"])
            result_data3.value = str(raam["beta01"])
            result_data4.value = str(raam["beta02"])
            result_tls.value = str(raam["tLS"])

            progress_bar.value = 1
            progress_text.value = "100%"
            status_text.value = "הפעולה הסתיימה בהצלחה."

        except requests.Timeout:
            status_text.value = "הפעולה נכשלה."
            show_message("החיבור ל-CDDIS ארך יותר מדי זמן.")

        except requests.HTTPError as error:
            status_text.value = "הפעולה נכשלה."
            code = error.response.status_code if error.response is not None else "לא ידוע"
            show_message(f"שגיאת שרת HTTP: {code}")

        except requests.RequestException as error:
            status_text.value = "הפעולה נכשלה."
            show_message(f"לא ניתן להתחבר ל-CDDIS: {error}")

        except Exception as error:
            status_text.value = "הפעולה נכשלה."
            show_message(str(error))

        finally:
            download_button.disabled = False
            page.update()

    download_button = ft.FilledButton(
        content="Download and calculate",
        icon=ft.Icons.CLOUD_DOWNLOAD,
        on_click=start_download,
    )

    page.add(
        ft.SafeArea(
            content=ft.Container(
                padding=20,
                content=ft.Column(
                    controls=[
                        title,
                        subtitle,
                        ft.Card(
                            content=ft.Container(
                                padding=18,
                                content=ft.Column(
                                    controls=[
                                        ft.ResponsiveRow(
                                            controls=[
                                                ft.Container(
                                                    content=username_field,
                                                    col={"xs": 12, "sm": 6},
                                                ),
                                                ft.Container(
                                                    content=password_field,
                                                    col={"xs": 12, "sm": 6},
                                                ),
                                            ]
                                        ),
                                        note,
                                    ]
                                ),
                            )
                        ),
                        ft.Row(
                            controls=[download_button],
                            alignment=ft.MainAxisAlignment.CENTER,
                        ),
                        progress_bar,
                        progress_text,
                        status_text,
                        ft.Card(
                            content=ft.Container(
                                padding=20,
                                content=ft.Column(
                                    controls=[
                                        ft.Text("Results", size=18, weight=ft.FontWeight.BOLD),
                                        ft.Divider(),
                                        result_row("Downloaded file:", result_file),
                                        result_row("Alpha:", result_alpha),
                                        result_row("Beta:", result_beta),
                                        result_row("Data 1:", result_data1),
                                        result_row("Data 2:", result_data2),
                                        result_row("Data 3:", result_data3),
                                        result_row("Data 4:", result_data4),
                                        result_row("tLS:", result_tls),
                                    ]
                                ),
                            )
                        ),
                    ],
                    spacing=14,
                    horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
                ),
            )
        )
    )


app = ft.run(main, assets_dir="assets", export_asgi_app=True)

if __name__ == "__main__":
    ft.run(main, assets_dir="assets")
