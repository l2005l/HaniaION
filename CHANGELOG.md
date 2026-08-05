# HaniaION v2.0.0

- Added three integrated satellite modes: interactive globe, Israel Sky and Mission Control.
- Replaced the external 3D rendering dependency with a self-contained Canvas renderer.
- Added clear Earth and Israel labels, orbit trails, satellite glyphs and click details.
- Added ground-sky bearing/elevation view with optional phone orientation.
- Added operational dashboard, world track map and 90-minute pass timeline.
- Preserved live TLE, cache and bundled fallback behavior from v1.2.1.

## v2.1.0 — Unified stale-data warnings
- Added a prominent site-wide warning banner for unavailable or stale data sources.
- Shows the last verified update time when available.
- RAAM/DATA1–DATA4 falls back to the last server/browser result when NASA CDDIS is unavailable.
- Satellite pages explicitly identify live versus cached TLE data.
- Windy map failures and offline state are clearly reported.
- Database save failures are distinguished from source-data failures.
