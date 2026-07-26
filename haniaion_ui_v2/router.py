from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

router = APIRouter(include_in_schema=False)
router.mount("/ui-static", StaticFiles(directory=STATIC_DIR), name="ui-static")

@router.get("/", response_class=HTMLResponse)
async def ui_home():
    return FileResponse(TEMPLATES_DIR / "index.html")

@router.get("/wind", response_class=HTMLResponse)
async def wind_page():
    return FileResponse(TEMPLATES_DIR / "wind.html")

@router.get("/manifest.webmanifest", include_in_schema=False)
async def manifest():
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")

@router.get("/sw.js", include_in_schema=False)
async def service_worker():
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")

@router.get("/favicon.svg", include_in_schema=False)
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")
