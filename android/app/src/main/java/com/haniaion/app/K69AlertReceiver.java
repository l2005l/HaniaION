package com.haniaion.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class K69AlertReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        int seconds = intent.getIntExtra("seconds", 0);
        showNotification(context, seconds, (int) (System.currentTimeMillis() % Integer.MAX_VALUE));
    }

    static void showNotification(Context context, int seconds, int notificationId) {
        String body = seconds == 0 ? "K הגיע עכשיו" : seconds == 60 ? "בעוד דקה יגיע K" : "בעוד " + seconds + " שניות יגיע K";
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, MainActivity.K69_CHANNEL_ID)
            .setSmallIcon(com.haniaion.app.R.drawable.ic_haniaion)
            .setContentTitle("HaniaION — התראת K-69")
            .setContentText(body).setContentIntent(content).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL)
            .build();
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
            .notify(notificationId, notification);
    }
}
