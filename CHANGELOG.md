
## v2.23.0 — K-69 background alert reliability
- K-69 Push alerts now always create a system notification, including when the installed PWA is visible.
- Foreground pages may additionally attempt Hebrew speech, but system notification delivery is no longer skipped.
- Failed Push deliveries are retried instead of being marked as sent.
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
