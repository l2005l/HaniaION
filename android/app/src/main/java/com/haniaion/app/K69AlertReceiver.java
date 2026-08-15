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
        String body = seconds == 0 ? "K הגיע עכשיו" : seconds == 60 ? "בעוד דקה יגיע K" : "בעוד " + seconds + " שניות יגיע K";
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, "k69_alerts")
            .setSmallIcon(com.haniaion.app.R.drawable.ic_haniaion)
            .setContentTitle("HaniaION — התראת K-69")
            .setContentText(body).setContentIntent(content).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC)
            .build();
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
            .notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), notification);
    }
}
