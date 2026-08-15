package com.haniaion.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.List;

final class K69Scheduler {
    static void schedule(Context context, long cycleAt, List<Integer> secondsValues) throws Exception {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        JSONArray saved = new JSONArray();
        int base = (int) ((cycleAt / 1000L) % 1_000_000L);
        for (int seconds : secondsValues) {
            long triggerAt = cycleAt - seconds * 1000L;
            if (triggerAt <= System.currentTimeMillis()) continue;
            int requestCode = base + seconds;
            Intent intent = new Intent(context, K69AlertReceiver.class)
                .putExtra("seconds", seconds).putExtra("cycle_at", cycleAt);
            PendingIntent pending = PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (android.os.Build.VERSION.SDK_INT >= 31 && manager.canScheduleExactAlarms()) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            saved.put(new JSONObject().put("cycle", cycleAt).put("seconds", seconds));
        }
        context.getSharedPreferences("k69", Context.MODE_PRIVATE).edit().putString("alarms", saved.toString()).apply();
    }
}
