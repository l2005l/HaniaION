package com.haniaion.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps HaniaION's GPS check alive while the app is in the background. Android requires a visible
 * notification for this; the GNSS listeners themselves live in NativeBridge and keep recording
 * readings, which the page reads back when the user returns.
 */
public class GnssWatchService extends Service {
    static final String CHANNEL_ID = "haniaion_gnss_watch";
    static final int NOTIFICATION_ID = 7406;
    static final String EXTRA_TEXT = "text";

    static void start(Context context, String text) {
        Intent intent = new Intent(context, GnssWatchService.class).putExtra(EXTRA_TEXT, text);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, GnssWatchService.class));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent != null && intent.getStringExtra(EXTRA_TEXT) != null ? intent.getStringExtra(EXTRA_TEXT) : "בודק שיבוש והטעיית GPS";
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "בדיקת GPS ברקע", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("מופיע כל עוד HaniaION בודק שיבוש והטעיית GPS כשהאפליקציה ברקע");
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        Notification notification = builder
            .setSmallIcon(com.haniaion.app.R.drawable.ic_haniaion)
            .setContentTitle("HaniaION בודק GPS")
            .setContentText(text)
            .setContentIntent(tap)
            .setOngoing(true)
            .build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIFICATION_ID, notification);
        } catch (Exception error) {
            // Without permission to run in the foreground the check simply pauses in the background.
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
