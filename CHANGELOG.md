
## 2.28
- Hardened VAPID private-key normalization: accepts PEM with real/literal newlines, PKCS8/SEC1 DER, base64url DER, and raw 32-byte P-256 scalars.
- PEM wrappers are no longer assumed to imply a particular inner format; malformed wrappers fall back to parsing the enclosed key material.
## 2.27.0 — VAPID validation + K-69 push diagnostics
- Validates the VAPID P-256 key pair before scheduling.
- Accepts PEM, base64url DER, or raw 32-byte private key input.
- Adds a browser-only `/vapid-generator` that never uploads generated keys.
- K-69 scheduling reports a clear error if the arm Push cannot be delivered.
- NASA and K-69 notification preferences remain independent.

# v2.14.0 — Mobile Action Landing Fixes

- GPS shortcut lands directly on the permission note and “בדוק GPS עכשיו” button.
- After the first GPS fix, the page moves to the live GNSS status metrics.
- NASA/BRDC results stop above DATA1–DATA4 so the first row is no longer hidden by the mobile header.
- K69 mobile layout is more compact: smaller countdown ring and a 2×2 time grid.
- PWA cache bumped to v2.14.0.

# v2.13.0 — Direct Result Jumps

- NASA download now scrolls directly to DATA1–DATA4 after a successful calculation.
- Quick K69 shortcut now scrolls directly to the live countdown/time dashboard.
- Results shortcut also targets the RAAM values instead of the BRDC metadata header.
- PWA cache version bumped.

# v2.12.0
- GNSS terminology: "רציפות Fix" renamed to "יציבות מיקום".
- "ביטחון" clarified as "ביטחון בתוצאה".

# HaniaION v2.7.0 — Command Center

- Added a compact Command Center that keeps NASA first and K69 second.
- Added live K69 countdown to the main dashboard.
- Fixed Satellite Live to consume the API `objects` collection.
- Satellite cached data is now yellow/warning instead of red/error.
- Live satellite data remains green; true absence of all data remains neutral/offline.
- Updated PWA cache versions.
\n\n## v2.24.0 — Push diagnostics\n- Added safe `/api/push/diagnostics` endpoint and in-app K-69 Push diagnostics.\n- Foreground K-69 Push now still creates an OS notification while attempting speech.\n- K-69 schedules are marked sent only after a successful Push delivery.\n- Added protected `/api/k69/process-due` endpoint for an external scheduler.\n

## v2.25.0 — K-69 armed background push

- The selected K-69 alerts are now armed immediately on the device with one Push message when scheduling.
- The Service Worker owns the short countdown for the selected next K cycle, so the Render Free web service does not need to remain awake until 60/30/10/0 seconds.
- Added acknowledgement/migration support to prevent duplicate server-side alerts after the device is armed.
