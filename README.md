# HaniaION UI Clean V2

Mobile-first replacement UI for an existing FastAPI application.

## Important integration rule

This package **does not define, replace, recalculate, or modify** `/api/calculate`.
The browser calls the existing endpoint and displays the returned values.

K69 is read directly from the endpoint response and displayed as a string. No K69 calculation exists in this package.

## Included

- New clean mobile-first GUI
- Dark and light mode
- UTC clock
- Online status
- Retrieve Latest Data
- Data1, Data2, Data3, Data4, tLS
- Compact K69 display at the top
- History stored in `localStorage`
- Copy
- TXT export
- JSON export of the original server response
- PWA manifest and service worker
- `/wind` page containing weather only
- Tests for required UI content and removed terminology

## Install into the existing repository

1. Copy the `haniaion_ui_v2` folder into the repository root.
2. Add the UI dependencies to the existing `requirements.txt` if they are not already present:

```text
fastapi>=0.115,<1
uvicorn[standard]>=0.30,<1
```

3. In the existing FastAPI module, preserve the complete `/api/calculate` function unchanged.
4. Disable docs when constructing the app:

```python
app = FastAPI(
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
```

5. After the existing API routes are registered, mount the UI:

```python
from haniaion_ui_v2 import router as ui_v2_router
app.include_router(ui_v2_router)
```

6. Ensure no older route still handles `/` or `/wind`. Remove only those older UI routes, not `/api/calculate`.

## Endpoint response compatibility

The UI accepts either a flat JSON response or an object nested under `data` or `result`.
It recognizes these keys case-insensitively where practical:

- `Data1`
- `Data2`
- `Data3`
- `Data4`
- `tLS`
- `K69`

The UI first sends `POST /api/calculate` with an empty JSON object. If the server responds with 405 or 422, it retries with GET. If the current endpoint requires a specific POST body, edit only the request payload in `static/app.js`; do not modify the server calculation.

## Local run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Windows:

```powershell
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

## Git: create and publish the branch

Run from the original repository after copying the package:

```bash
git switch main
git pull origin main
git switch -c ui-clean-v2

git add haniaion_ui_v2 integration.py tests/test_ui_v2.py render.yaml README.md requirements.txt
git commit -m "Build clean mobile-first HaniaION V2 UI"
git push -u origin ui-clean-v2
```

## Render: deploy the new branch before merging

1. Open the existing Render Web Service.
2. Open **Settings**.
3. Change **Branch** from `main` to `ui-clean-v2`.
4. Verify:
   - Build command: `pip install -r requirements.txt`
   - Start command matches the existing app, commonly:
     `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Trigger **Manual Deploy → Deploy latest commit**.
6. Test:
   - `/`
   - `/wind`
   - `/docs` returns 404
   - `/redoc` returns 404
   - `/openapi.json` returns 404
   - Retrieve Latest Data
   - K69 matches the old site exactly
   - Copy, TXT, JSON
   - Install as PWA

## Merge to main

After validation:

```bash
git switch main
git pull origin main
git merge --no-ff ui-clean-v2
git push origin main
```

Then set the Render branch back to `main` and deploy the latest commit.

## Rollback

Before merging, set Render branch back to `main`.

After merging, either revert the merge commit:

```bash
git revert -m 1 <merge_commit_sha>
git push origin main
```

or redeploy a known-good commit from Render.
