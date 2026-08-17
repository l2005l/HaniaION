package com.haniaion.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class NativeBridge {
    private final Activity activity;
    private TextToSpeech speech;
    private volatile boolean speechReady;
    private final LocationManager locationManager;
    private volatile String gnssSnapshot = "{\"supported\":true,\"active\":false,\"satellites\":[]}";
    private volatile boolean gnssRunning;
    private final LocationListener locationListener = new LocationListener() {
        @Override public void onLocationChanged(Location location) { }
        @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
        @Override public void onProviderEnabled(String provider) { }
        @Override public void onProviderDisabled(String provider) { }
    };
    private final GnssStatus.Callback gnssCallback = new GnssStatus.Callback() {
        @Override public void onStarted() { gnssRunning = true; }
        @Override public void onStopped() { gnssRunning = false; }
        @Override public void onSatelliteStatusChanged(GnssStatus status) { updateGnssSnapshot(status); }
    };

    NativeBridge(Activity activity) {
        this.activity = activity;
        locationManager = (LocationManager) activity.getSystemService(Activity.LOCATION_SERVICE);
        speech = new TextToSpeech(activity.getApplicationContext(), status -> {
            speechReady = status == TextToSpeech.SUCCESS;
            if (speechReady && speech != null) {
                speech.setLanguage(new Locale("he", "IL"));
                speech.setAudioAttributes(new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            }
        });
    }

    @JavascriptInterface public String startGnssMonitor() {
        if (activity.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return "location-permission-required";
        }
        activity.runOnUiThread(() -> {
            try {
                if (!gnssRunning) {
                    if (Build.VERSION.SDK_INT >= 30) {
                        locationManager.registerGnssStatusCallback(activity.getMainExecutor(), gnssCallback);
                    } else {
                        locationManager.registerGnssStatusCallback(gnssCallback, new Handler(Looper.getMainLooper()));
                    }
                    locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, locationListener);
                    gnssRunning = true;
                }
            } catch (Exception error) {
                gnssSnapshot = "{\"supported\":false,\"error\":\"" + error.getClass().getSimpleName() + "\",\"satellites\":[]}";
            }
        });
        return "starting";
    }

    @JavascriptInterface public String getGnssSnapshot() { return gnssSnapshot; }

    @JavascriptInterface public void stopGnssMonitor() {
        activity.runOnUiThread(this::stopGnssInternal);
    }

    private void updateGnssSnapshot(GnssStatus status) {
        try {
            JSONObject root = new JSONObject();
            JSONArray satellites = new JSONArray();
            int used = 0;
            for (int i = 0; i < status.getSatelliteCount(); i++) {
                JSONObject satellite = new JSONObject();
                boolean inFix = status.usedInFix(i);
                if (inFix) used++;
                satellite.put("constellation", constellationName(status.getConstellationType(i)));
                satellite.put("svid", status.getSvid(i));
                satellite.put("used", inFix);
                satellite.put("cn0", Math.round(status.getCn0DbHz(i) * 10f) / 10.0);
                satellite.put("elevation", Math.round(status.getElevationDegrees(i) * 10f) / 10.0);
                satellite.put("azimuth", Math.round(status.getAzimuthDegrees(i) * 10f) / 10.0);
                satellite.put("ephemeris", status.hasEphemerisData(i));
                satellite.put("almanac", status.hasAlmanacData(i));
                if (Build.VERSION.SDK_INT >= 26 && status.hasCarrierFrequencyHz(i)) {
                    satellite.put("frequency_mhz", Math.round(status.getCarrierFrequencyHz(i) / 100000f) / 10.0);
                }
                satellites.put(satellite);
            }
            root.put("supported", true);
            root.put("active", true);
            root.put("visible", status.getSatelliteCount());
            root.put("used", used);
            root.put("updated_at", System.currentTimeMillis());
            root.put("satellites", satellites);
            gnssSnapshot = root.toString();
        } catch (Exception ignored) { }
    }

    private String constellationName(int type) {
        switch (type) {
            case GnssStatus.CONSTELLATION_GPS: return "GPS";
            case GnssStatus.CONSTELLATION_GALILEO: return "Galileo";
            case GnssStatus.CONSTELLATION_GLONASS: return "GLONASS";
            case GnssStatus.CONSTELLATION_BEIDOU: return "BeiDou";
            case GnssStatus.CONSTELLATION_SBAS: return "SBAS";
            case GnssStatus.CONSTELLATION_QZSS: return "QZSS";
            case GnssStatus.CONSTELLATION_IRNSS: return "NavIC";
            default: return "אחר";
        }
    }

    private void stopGnssInternal() {
        if (!gnssRunning) return;
        try { locationManager.unregisterGnssStatusCallback(gnssCallback); } catch (Exception ignored) { }
        try { locationManager.removeUpdates(locationListener); } catch (Exception ignored) { }
        gnssRunning = false;
    }

    @JavascriptInterface public String scheduleK69Alerts(String cycleIso, String secondsJson) {
        try {
            long cycleAt = Instant.parse(cycleIso).toEpochMilli();
            JSONArray values = new JSONArray(secondsJson);
            List<Integer> seconds = new ArrayList<>();
            for (int i = 0; i < values.length(); i++) seconds.add(values.getInt(i));
            int scheduled = K69Scheduler.schedule(activity, cycleAt, seconds);
            return "ok:" + scheduled + ":android-alarm-clock";
        } catch (Exception error) {
            if (error instanceof SecurityException && error.getMessage() != null) return error.getMessage();
            return "לא ניתן לתזמן התראות Android: " + error.getClass().getSimpleName();
        }
    }

    @JavascriptInterface public String speakK69Alert(int seconds) {
        if (!speechReady) return "מנוע הקול עדיין נטען. נסה שוב בעוד רגע.";
        activity.runOnUiThread(() -> {
            speech.stop();
            Bundle options = new Bundle();
            options.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
            speech.speak(message(seconds), TextToSpeech.QUEUE_FLUSH, options, "haniaion-k69-test");
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
        stopGnssInternal();
        if (speech != null) { speech.stop(); speech.shutdown(); }
    }

    @JavascriptInterface public String platform() { return "android-native"; }

    @JavascriptInterface public int versionCode() {
        try {
            if (Build.VERSION.SDK_INT >= 28) return (int) activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).getLongVersionCode();
            return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionCode;
        } catch (Exception ignored) { return 0; }
    }

    @JavascriptInterface public String versionName() {
        try { return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName; }
        catch (Exception ignored) { return "unknown"; }
    }

    @JavascriptInterface public void openUpdate(String url) {
        activity.runOnUiThread(() -> {
            try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch (Exception ignored) { }
        });
    }
}
