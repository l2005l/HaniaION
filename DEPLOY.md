# HaniaION deployment checklist

Production URL: `https://gps.hania360.com`

1. Deploy the `feature/final-ui` branch to the existing Google Cloud Run service.
2. Keep `DATABASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` configured in Cloud Run.
3. Configure the same strong `CRON_SECRET` value in both Cloud Run and the GitHub repository Actions secrets.
4. Run the **Monitor BRDC source** workflow manually once and confirm that it succeeds.
5. Verify `/api/health`, `/api/monitor/status`, Android download, History, and Push diagnostics.

Do not configure a minimum Cloud Run instance when the goal is to remain inside the request-based free allowance.
