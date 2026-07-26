"""
Add these lines to the existing FastAPI application module.

This module does not define or modify /api/calculate.
It only mounts the new UI router and disables public API documentation
when the FastAPI app is created with docs_url=None and redoc_url=None.
"""

# Existing creation should become:
#
# from fastapi import FastAPI
# app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
#
# Keep the existing /api/calculate code exactly as-is.
#
# Then, after existing API routes are registered:
#
# from haniaion_ui_v2 import router as ui_v2_router
# app.include_router(ui_v2_router)
