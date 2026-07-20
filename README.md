# HaniaION

HaniaION is an open-source GNSS ionospheric-data platform built with Python and FastAPI.

It retrieves the latest BRDC navigation file from NASA CDDIS Earthdata, extracts the GPS Klobuchar Alpha/Beta coefficients and leap-second value, and converts them into RAAM-compatible integer data words.

## Features

- Automatic search across the latest seven UTC daily BRDC directories
- NASA Earthdata authenticated download
- RINEX 2 and RINEX 3 Klobuchar header parsing
- RAAM conversion into Data1, Data2, Data3, Data4, and tLS
- Fifteen-minute server cache
- Retry strategy and request rate limiting
- FastAPI interactive documentation
- Responsive dashboard with dark/light themes
- Copy, TXT, JSON, and CSV export
- Installable PWA shell
- Docker and Render deployment configuration

## Local run

1. Create a Python virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Set environment variables:

```text
EARTHDATA_USERNAME=your_username
EARTHDATA_PASSWORD=your_password
```

4. Start the app:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

5. Open `http://localhost:8000`.

## API

- `GET /api/health` — service health
- `POST /api/calculate` — retrieve and convert the latest available BRDC data
- `GET /docs` — interactive OpenAPI documentation

## Render deployment

The repository includes `render.yaml` and a Dockerfile.

In the Render service, add these secret environment variables:

- `EARTHDATA_USERNAME`
- `EARTHDATA_PASSWORD`

Do not commit Earthdata credentials to GitHub.


## GPS Pulse Monitor

The frontend includes a clearly labelled external-source card linking to the trusted K-69 live GPS pulse monitor. The external page opens in a separate tab and HaniaION does not alter its values.


## v2.6
- Smart Android PWA install prompt
- iPhone Add to Home Screen guidance
- Top and hero shortcuts to the embedded K-69 GPS Pulse Monitor
