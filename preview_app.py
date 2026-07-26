from fastapi import FastAPI
from haniaion_ui_v2 import router as ui_v2_router

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(ui_v2_router)
