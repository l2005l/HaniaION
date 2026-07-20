# HaniaION

## GNSS Klobuchar Ionospheric Data API

HaniaION is an open-source software development project.

The project provides a web application and API that automatically retrieves the latest GNSS Klobuchar ionospheric coefficients from NASA CDDIS (Earthdata), converts them into RAAM-compatible values, and exposes them for navigation software.

### Features

- Automatic download of the latest BRDC navigation file
- Klobuchar coefficient extraction
- RAAM format conversion
- REST API
- Docker support
- Render deployment
- Open source Python project

Repository purpose:
This repository demonstrates Python backend development, API design, Docker deployment, and GNSS navigation software integration.
# HaniaION RAAM

## Render

Add these secret environment variables:

- `EARTHDATA_USERNAME`
- `EARTHDATA_PASSWORD`

The service uses the included Dockerfile.

Health check:

`/api/health`
