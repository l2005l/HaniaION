package com.haniaion.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends android.app.Activity {
    private static final String HOME_URL = "https://haniaion-283044732985.me-west1.run.app";
    private static final long[] RETRY_DELAYS_MS = {2_000, 4_000, 8_000};
    static final String K69_CHANNEL_ID = "k69_alerts_v4";
    private WebView webView;
    private NativeBridge nativeBridge;
    private View splashView;
    private TextView splashMessage;
    private Button retryButton;
    private final Handler retryHandler = new Handler(Looper.getMainLooper());
    private int retryCount;
    private boolean loadFailed;
    private boolean retryScheduled;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        createNotificationChannel();
        requestAppPermissions();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(6, 16, 29));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                top = insets.getInsets(WindowInsets.Type.statusBars()).top;
                bottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            int extraTop = Math.round(18 * getResources().getDisplayMetrics().density);
            view.setPadding(0, top + extraTop, 0, bottom);
            return insets;
        });
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(6, 16, 29));
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        LinearLayout splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setPadding(dp(28), dp(28), dp(28), dp(28));
        splash.setBackgroundColor(Color.rgb(6, 16, 29));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_haniaion);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(92), dp(92));
        logoParams.bottomMargin = dp(28);
        splash.addView(logo, logoParams);

        splashMessage = new TextView(this);
        splashMessage.setText("ההפעלה הראשונה עשויה להימשך מספר שניות");
        splashMessage.setTextColor(Color.WHITE);
        splashMessage.setTextSize(18);
        splashMessage.setGravity(Gravity.CENTER);
        splashMessage.setTextDirection(View.TEXT_DIRECTION_RTL);
        splash.addView(splashMessage, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        retryButton = new Button(this);
        retryButton.setText("נסה שוב");
        retryButton.setTextSize(17);
        retryButton.setVisibility(View.GONE);
        retryButton.setOnClickListener(view -> startInitialLoad());
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        retryParams.topMargin = dp(22);
        splash.addView(retryButton, retryParams);

        splashView = splash;
        root.addView(splash, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " HaniaIONNative/3.0");
        nativeBridge = new NativeBridge(this);
        webView.addJavascriptInterface(nativeBridge, "HaniaAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                loadFailed = false;
                retryScheduled = false;
            }

            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (loadFailed || !isHomePage(url)) return;
                view.evaluateJavascript(
                    "(function(){return document.body && /rate\\s+exceeded/i.test(document.body.innerText || '');})()",
                    result -> {
                        if ("true".equals(result)) handleInitialLoadFailure();
                        else if (!loadFailed) hideSplash();
                    }
                );
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                super.onReceivedHttpError(view, request, response);
                if (request.isForMainFrame() && (response.getStatusCode() == 429 || response.getStatusCode() >= 500)) {
                    handleInitialLoadFailure();
                }
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) handleInitialLoadFailure();
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if ("haniaion-283044732985.me-west1.run.app".equalsIgnoreCase(uri.getHost())
        || "haniaion-preview.onrender.com".equalsIgnoreCase(uri.getHost())
        || "haniaion.onrender.com".equalsIgnoreCase(uri.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                boolean granted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                callback.invoke(origin, granted, false);
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.grant(request.getResources()); }
        });
        startInitialLoad();
    }

    private boolean isHomePage(String url) {
        if (url == null) return false;
        String host = Uri.parse(url).getHost();
        return "haniaion-283044732985.me-west1.run.app".equalsIgnoreCase(host)
            || "haniaion-preview.onrender.com".equalsIgnoreCase(host)
            || "haniaion.onrender.com".equalsIgnoreCase(host);
    }

    private void startInitialLoad() {
        retryHandler.removeCallbacksAndMessages(null);
        retryCount = 0;
        loadFailed = false;
        retryScheduled = false;
        splashView.animate().cancel();
        splashView.setAlpha(1f);
        splashView.setVisibility(View.VISIBLE);
        splashMessage.setText("ההפעלה הראשונה עשויה להימשך מספר שניות");
        retryButton.setVisibility(View.GONE);
        webView.loadUrl(HOME_URL);
    }

    private void handleInitialLoadFailure() {
        if (splashView.getVisibility() != View.VISIBLE || retryScheduled) return;
        loadFailed = true;
        if (retryCount < RETRY_DELAYS_MS.length) {
            long delay = RETRY_DELAYS_MS[retryCount++];
            retryScheduled = true;
            webView.stopLoading();
            splashMessage.setText("לא הצלחנו להתחבר. מנסים שוב בעוד " + (delay / 1000) + " שניות…");
            retryHandler.postDelayed(() -> {
                retryScheduled = false;
                webView.loadUrl(HOME_URL);
            }, delay);
        } else {
            webView.stopLoading();
            splashMessage.setText("לא ניתן להתחבר לשירות כרגע. בדקו את החיבור לאינטרנט ונסו שוב.");
            retryButton.setVisibility(View.VISIBLE);
        }
    }

    private void hideSplash() {
        retryHandler.removeCallbacksAndMessages(null);
        if (splashView.getVisibility() != View.VISIBLE) return;
        splashView.animate().alpha(0f).setDuration(220).withEndAction(() ->
            splashView.setVisibility(View.GONE)
        ).start();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(K69_CHANNEL_ID, "התראות K-69", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("התראות למחזורי K-69");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 350, 180, 350});
            channel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()
            );
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private void requestAppPermissions() {
        List<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), 4100);
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

    @Override protected void onDestroy() {
        retryHandler.removeCallbacksAndMessages(null);
        if (nativeBridge != null) nativeBridge.shutdown();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
