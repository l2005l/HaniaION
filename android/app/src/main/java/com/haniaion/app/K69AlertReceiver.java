package com.haniaion.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

public class K69AlertReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        int seconds = intent.getIntExtra("seconds", 0);
        showNotification(context, seconds, (int) (System.currentTimeMillis() % Integer.MAX_VALUE));
        speakInBackground(context, seconds, goAsync());
    }

    static void showNotification(Context context, int seconds, int notificationId) {
        String body = seconds == 300 ? "הגיע הזמן להדליק איגי" : seconds == 0 ? "K הגיע עכשיו" : seconds == 60 ? "בעוד דקה יגיע K" : "בעוד " + seconds + " שניות יגיע K";
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, MainActivity.K69_CHANNEL_ID)
            .setSmallIcon(com.haniaion.app.R.drawable.ic_haniaion)
            .setContentTitle("HaniaION — התראת K-69")
            .setContentText(body).setContentIntent(content).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL)
            .build();
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
            .notify(notificationId, notification);
    }

    private static void speakInBackground(Context context, int seconds, PendingResult pending) {
        Context app = context.getApplicationContext();
        PowerManager power = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HaniaION:K69Speech");
        wakeLock.acquire(12_000L);
        AtomicBoolean finished = new AtomicBoolean(false);
        TextToSpeech[] holder = new TextToSpeech[1];

        Runnable finish = () -> {
            if (!finished.compareAndSet(false, true)) return;
            if (holder[0] != null) { holder[0].stop(); holder[0].shutdown(); }
            if (wakeLock.isHeld()) wakeLock.release();
            pending.finish();
        };

        new Handler(Looper.getMainLooper()).postDelayed(finish, 9_000L);
        holder[0] = new TextToSpeech(app, status -> {
            if (status != TextToSpeech.SUCCESS || holder[0] == null) { finish.run(); return; }
            TextToSpeech speech = holder[0];
            speech.setLanguage(new Locale("he", "IL"));
            speech.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
            speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { finish.run(); }
                @Override public void onError(String id) { finish.run(); }
            });
            Bundle speechOptions = new Bundle();
            speechOptions.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
            int result = speech.speak(spokenText(seconds), TextToSpeech.QUEUE_FLUSH, speechOptions, "haniaion-k69-background");
            if (result == TextToSpeech.ERROR) finish.run();
        });
    }

    private static String spokenText(int seconds) {
        if (seconds == 300) return "הגיע הזמן להדליק איגי";
        if (seconds == 0) return "מפתח קיי הגיע עכשיו";
        if (seconds == 60) return "בעוד דקה יגיע המפתח";
        if (seconds == 30) return "בעוד שלושים שניות יגיע המפתח";
        if (seconds == 10) return "בעוד עשר שניות יגיע המפתח";
        return "בעוד " + seconds + " שניות יגיע המפתח";
    }
}
