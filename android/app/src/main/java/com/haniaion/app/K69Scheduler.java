package com.haniaion.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.List;

final class K69Scheduler {
    static int schedule(Context context, long cycleAt, List<Integer> secondsValues) throws Exception {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (android.os.Build.VERSION.SDK_INT >= 31 && !manager.canScheduleExactAlarms()) {
            throw new SecurityException("יש לאשר 'התראות ותזכורות' בהגדרות Android ואז לתזמן שוב");
        }
        JSONArray saved = new JSONArray();
        int scheduled = 0;
        int base = (int) ((cycleAt / 1000L) % 1_000_000L);
        for (int seconds : secondsValues) {
            long triggerAt = cycleAt - seconds * 1000L;
            if (triggerAt <= System.currentTimeMillis()) continue;
            int requestCode = base + seconds;
            Intent intent = new Intent(context, K69AlertReceiver.class)
                .putExtra("seconds", seconds).putExtra("cycle_at", cycleAt);
            PendingIntent pending = PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            manager.cancel(pending);
            Intent openIntent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent showIntent = PendingIntent.getActivity(context, requestCode, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            manager.setAlarmClock(new AlarmManager.AlarmClockInfo(triggerAt, showIntent), pending);
            saved.put(new JSONObject().put("cycle", cycleAt).put("seconds", seconds));
            scheduled++;
        }
        context.getSharedPreferences("k69", Context.MODE_PRIVATE).edit().putString("alarms", saved.toString()).apply();
        return scheduled;
    }
}
