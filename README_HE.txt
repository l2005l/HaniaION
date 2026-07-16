IONOSPHERE RAAM — PWA READY

בדיקה מקומית בדפדפן
-------------------
לחץ פעמיים על start_web.bat
ואז פתח:
http://localhost:8000

בדיקה כתוכנת מחשב
----------------
לחץ פעמיים על start_desktop.bat

התקנה בטלפון
------------
כדי להתקין כ-PWA, צריך לפרסם את הפרויקט בכתובת HTTPS.

Android:
פתח ב-Chrome ובחר Install app או Add to Home screen.

iPhone:
פתח ב-Safari, לחץ Share ואז Add to Home Screen.

פריסה
-----
הפרויקט כולל Dockerfile ומתאים לשירות אירוח שתומך:
- Docker
- HTTPS
- WebSocket

פקודת השרת:
uvicorn main:app --host 0.0.0.0 --port 8000

אבטחה
-----
שם המשתמש והסיסמה של Earthdata אינם נשמרים בקוד או בקובץ.
יש להזין אותם בכל הפעלה של גרסת האינטרנט.
