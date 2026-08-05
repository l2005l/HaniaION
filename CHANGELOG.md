## v1.1.1 — Satellite 3D loader fix
- Fixed the removed Three.js global build URL.
- Added a secondary CDN fallback.
- Bumped PWA cache to force clients to receive the fix.
- Added a clearer WebGL compatibility message.

# HaniaION v1.0

- ממשק ראשי ממוקד ל־RAAM
- כותרת אחידה וברורה
- היסטוריה והשוואה מקומית
- גרפים וייצוא CSV
- לוח מצב BRDC
- התראות Push אופציונליות
- בדיקה אוטומטית כל 3 שעות
- התקנה בטלפון
- K-69 מוטמע
- מפת רוחות ותכנון מסלול בעברית

## 1.2.0 — Real public satellite orbits
- Replaced demo satellite coordinates with CelesTrak Earth Resources TLE data.
- Added server-side SGP4 propagation and `/api/satellites/coverage`.
- Added real current positions, coarse 90-minute tracks and estimated geometric windows.
- Clearly separates real orbit data from unknown sensor pointing/activity.
