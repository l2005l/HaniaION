# HaniaION v1.0

מערכת ממוקדת לחילוץ קובץ BRDC העדכני, קריאת מקדמי Klobuchar והמרתם לערכי RAAM.

## מה כלול

- חילוץ והצגת Data 1–4 ו־tLS
- היסטוריה מקומית והשוואה בין תוצאות
- גרפים וייצוא היסטוריה ל־CSV
- התקנה בטלפון כ־PWA
- תצוגת K-69 בתוך האתר
- עמוד `/wind` עם מפת רוחות, תכנון מסלול וסיכום
- התראות Push אופציונליות בלבד
- בדיקת BRDC אוטומטית כל 3 שעות באמצעות GitHub Actions
- שמירת היסטוריה מרכזית ומנויי Push ב־PostgreSQL/Neon

האתר הראשי והחילוץ הידני עובדים גם ללא מסד נתונים וללא Push.

## משתני סביבה בסיסיים ב־Render

חובה לחילוץ BRDC:

```text
EARTHDATA_USERNAME
EARTHDATA_PASSWORD
```

להיסטוריה מרכזית, ניטור והתראות:

```text
DATABASE_URL
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
CRON_SECRET
APP_VERSION=1.0.0
```

`VAPID_SUBJECT` יכול להיות לדוגמה:

```text
mailto:your-email@example.com
```

## יצירת מפתחות Push

לאחר התקנת הדרישות:

```bash
python scripts/generate_vapid_keys.py
```

שמור את המפתח הפרטי רק ב־Render. אין להעלות אותו ל־GitHub.

## GitHub Actions — בדיקה כל 3 שעות

ב־GitHub, תחת **Settings → Secrets and variables → Actions**, הוסף:

```text
HANIAION_APP_URL=https://haniaion.onrender.com
HANIAION_CRON_SECRET=<אותו ערך של CRON_SECRET ב-Render>
```

הקובץ `.github/workflows/monitor.yml` מפעיל את `/api/monitor/run` כל שלוש שעות.

## Neon

צור PostgreSQL חינמי ב־Neon והעתק את מחרוזת החיבור המלאה אל `DATABASE_URL` ב־Render. הטבלאות נוצרות אוטומטית בזמן עליית השירות.

## כתובות מרכזיות

```text
/                 האתר הראשי
/wind             מפת רוחות ותכנון מסלול
/api/health       בדיקת שירות
/api/history      היסטוריה מרכזית
/api/monitor/status מצב הניטור
/admin            מסך ניהול
```

## הערה

מפת הרוחות וכלי המסלול מיועדים לתצוגה כללית בלבד ואינם תחליף למידע תעופתי רשמי או למערכת תכנון מוסמכת.


## v2.3.0
Adds a compact system-health view and fixes false duplicate-history warnings. A duplicate result is a normal outcome: it is already present in cloud history.


## v2.5.0
History and charts now merge local device records with the PostgreSQL cloud history endpoint.


## K-69 background alerts (v2.19)
The K-69 alert switch schedules **only the currently displayed K cycle**. Selected 60/30/10/0-second alerts are stored server-side against the browser Push subscription. While the page is foregrounded, spoken Hebrew announcements are used; when the phone is locked/backgrounded, Web Push delivers a system notification.

For background delivery, configure `DATABASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in the deployment environment. The server starts a lightweight K-69 delivery worker when Push is configured.

Important: Web Push can provide a lock-screen/system notification in the background; it cannot guarantee spoken TTS while an iPhone/Android browser is suspended. The existing Android APK is a web wrapper pointing at the live HaniaION site, so its web content receives these deployed changes, but a future native Android build can add true system-level spoken audio.
