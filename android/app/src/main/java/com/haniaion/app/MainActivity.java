package com.haniaion.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends android.app.Activity {
    private static final String HOME_URL = "https://haniaion-preview.onrender.com";
    private WebView webView;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        createNotificationChannel();
        requestNotificationPermission();

        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " HaniaIONNative/3.0");
        webView.addJavascriptInterface(new NativeBridge(this), "HaniaAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if ("haniaion-preview.onrender.com".equalsIgnoreCase(uri.getHost())
        || "haniaion.onrender.com".equalsIgnoreCase(uri.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.grant(request.getResources()); }
        });
        webView.loadUrl(HOME_URL);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("k69_alerts", "התראות K-69", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("התראות למחזורי K-69");
            channel.enableVibration(true);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4100);
        }
        if (Build.VERSION.SDK_INT >= 31) {
            AlarmManager alarms = getSystemService(AlarmManager.class);
            if (!alarms.canScheduleExactAlarms()) {
                try { startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()))); }
                catch (Exception ignored) { Toast.makeText(this, "יש לאפשר תזמון מדויק בהגדרות", Toast.LENGTH_LONG).show(); }
            }
        }
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
