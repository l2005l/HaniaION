package com.haniaion.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        try {
            String raw = context.getSharedPreferences("k69", Context.MODE_PRIVATE).getString("alarms", "[]");
            JSONArray rows = new JSONArray(raw);
            if (rows.length() == 0) return;
            long cycle = rows.getJSONObject(0).getLong("cycle");
            if (cycle <= System.currentTimeMillis()) return;
            List<Integer> seconds = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) seconds.add(rows.getJSONObject(i).getInt("seconds"));
            K69Scheduler.schedule(context, cycle, seconds);
        } catch (Exception ignored) { }
    }
}
