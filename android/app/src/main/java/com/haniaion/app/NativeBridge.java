package com.haniaion.app;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public class NativeBridge {
    private final Activity activity;
    NativeBridge(Activity activity) { this.activity = activity; }

    @JavascriptInterface public String scheduleK69Alerts(String cycleIso, String secondsJson) {
        try {
            long cycleAt = Instant.parse(cycleIso).toEpochMilli();
            JSONArray values = new JSONArray(secondsJson);
            List<Integer> seconds = new ArrayList<>();
            for (int i = 0; i < values.length(); i++) seconds.add(values.getInt(i));
            K69Scheduler.schedule(activity, cycleAt, seconds);
            return "ok";
        } catch (Exception error) {
            return "לא ניתן לתזמן התראות Android: " + error.getClass().getSimpleName();
        }
    }

    @JavascriptInterface public String platform() { return "android-native"; }
}
