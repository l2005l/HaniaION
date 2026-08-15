package com.haniaion.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class NativeBridge {
    private final Activity activity;
    private TextToSpeech speech;
    private volatile boolean speechReady;

    NativeBridge(Activity activity) {
        this.activity = activity;
        speech = new TextToSpeech(activity.getApplicationContext(), status -> {
            speechReady = status == TextToSpeech.SUCCESS;
            if (speechReady && speech != null) speech.setLanguage(new Locale("he", "IL"));
        });
    }

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

    @JavascriptInterface public String speakK69Alert(int seconds) {
        if (!speechReady) return "מנוע הקול עדיין נטען. נסה שוב בעוד רגע.";
        activity.runOnUiThread(() -> {
            speech.stop();
            speech.speak(message(seconds), TextToSpeech.QUEUE_FLUSH, null, "haniaion-k69-test");
        });
        return "ok";
    }

    @JavascriptInterface public String testK69Alert(int seconds) {
        try {
            K69AlertReceiver.showNotification(activity, seconds, 900069);
            String result = speakK69Alert(seconds);
            return "ok".equals(result) ? "ok" : result;
        } catch (Exception error) {
            return "לא ניתן להפעיל בדיקה: " + error.getClass().getSimpleName();
        }
    }

    private String message(int seconds) {
        if (seconds == 0) return "מפתח קיי הגיע עכשיו";
        if (seconds == 60) return "בעוד דקה יגיע המפתח";
        if (seconds == 30) return "בעוד שלושים שניות יגיע המפתח";
        if (seconds == 10) return "בעוד עשר שניות יגיע המפתח";
        return "בעוד " + seconds + " שניות יגיע המפתח";
    }

    void shutdown() {
        if (speech != null) { speech.stop(); speech.shutdown(); }
    }

    @JavascriptInterface public String platform() { return "android-native"; }
}
