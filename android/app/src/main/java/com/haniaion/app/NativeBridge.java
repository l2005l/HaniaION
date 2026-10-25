package com.haniaion.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.provider.Settings;
import android.content.SharedPreferences;
import android.app.DownloadManager;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.location.GnssStatus;
import android.location.GnssMeasurement;
import android.location.GnssMeasurementsEvent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class NativeBridge {
    private final Activity activity;
    private final UpdateManager updateManager;
    private TextToSpeech speech;
    private volatile boolean speechReady;
    private final LocationManager locationManager;
    private volatile String gnssSnapshot = "{\"supported\":true,\"active\":false,\"satellites\":[]}";
    private volatile boolean gnssRunning;
    // The last fixes from the satellites and from the network (cell towers and WiFi), and the
    // receiver's gain (AGC): together they show jamming and spoofing that the position alone hides.
    private volatile Location lastGnss;
    private volatile Location lastNetwork;
    private volatile long gnssTimeOffsetMs;
    private volatile boolean gnssTimeOffsetKnown;
    private volatile String agcJson = "[]";
    // Every reading of the last 30 minutes, so a check keeps counting while the app is in the background.
    private final java.util.ArrayDeque<String> history = new java.util.ArrayDeque<>();
    private static final int HISTORY_MAX = 1800;
    private final LocationListener networkListener = new LocationListener() {
        @Override public void onLocationChanged(Location location) { lastNetwork = location; }
        @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
        @Override public void onProviderEnabled(String provider) { }
        @Override public void onProviderDisabled(String provider) { }
    };
    private final GnssMeasurementsEvent.Callback measurementsCallback = new GnssMeasurementsEvent.Callback() {
        @Override public void onGnssMeasurementsReceived(GnssMeasurementsEvent event) { readAgc(event); }
    };
    private final LocationListener locationListener = new LocationListener() {
        @Override public void onLocationChanged(Location location) {
            lastGnss = location;
            gnssTimeOffsetMs = location.getTime() - System.currentTimeMillis();
            gnssTimeOffsetKnown = true;
        }
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
        this.updateManager = new UpdateManager(activity);
        locationManager = (LocationManager) activity.getSystemService(Activity.LOCATION_SERVICE);
        speech = new TextToSpeech(activity.getApplicationContext(), status -> {
            speechReady = status == TextToSpeech.SUCCESS;
            if (speechReady && speech != null) {
                speech.setLanguage(new Locale("he", "IL"));
                speech.setAudioAttributes(new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
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
                    try {
                        if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                            locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10000L, 0f, networkListener);
                            Location known = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                            if (known != null && System.currentTimeMillis() - known.getTime() < 10 * 60 * 1000L) lastNetwork = known;
                        }
                    } catch (Exception ignored) { }
                    try {
                        if (Build.VERSION.SDK_INT >= 30) {
                            locationManager.registerGnssMeasurementsCallback(activity.getMainExecutor(), measurementsCallback);
                        } else {
                            locationManager.registerGnssMeasurementsCallback(measurementsCallback, new Handler(Looper.getMainLooper()));
                        }
                    } catch (Exception ignored) { }
                    gnssRunning = true;
                }
            } catch (Exception error) {
                gnssSnapshot = "{\"supported\":false,\"error\":\"" + error.getClass().getSimpleName() + "\",\"satellites\":[]}";
            }
        });
        return "starting";
    }

    @JavascriptInterface public String getGnssSnapshot() { return gnssSnapshot; }

    /** Readings recorded after `sinceMs` (by their updated_at), oldest first, as a JSON array. */
    @JavascriptInterface public String getGnssHistory(double sinceMs) {
        StringBuilder out = new StringBuilder("[");
        synchronized (history) {
            boolean first = true;
            for (String item : history) {
                try {
                    if (new JSONObject(item).optLong("updated_at", 0) <= (long) sinceMs) continue;
                } catch (Exception ignored) { continue; }
                if (!first) out.append(',');
                out.append(item);
                first = false;
            }
        }
        return out.append(']').toString();
    }

    /** Keep the check running with the app in the background (a notification shows while it runs). */
    @JavascriptInterface public String startBackgroundWatch(String text) {
        try {
            GnssWatchService.start(activity.getApplicationContext(), text == null ? "" : text);
            return "ok";
        } catch (Exception error) {
            return "error:" + error.getClass().getSimpleName();
        }
    }

    @JavascriptInterface public void stopBackgroundWatch() {
        try { GnssWatchService.stop(activity.getApplicationContext()); } catch (Exception ignored) { }
    }

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
            Location fix = lastGnss;
            if (fix != null) root.put("location", locationJson(fix));
            Location net = lastNetwork;
            if (net != null) root.put("network", locationJson(net));
            if (gnssTimeOffsetKnown) root.put("time_offset_ms", gnssTimeOffsetMs);
            root.put("agc", new JSONArray(agcJson));
            gnssSnapshot = root.toString();
            synchronized (history) {
                history.addLast(gnssSnapshot);
                while (history.size() > HISTORY_MAX) history.removeFirst();
            }
        } catch (Exception ignored) { }
    }

    private JSONObject locationJson(Location l) throws Exception {
        JSONObject o = new JSONObject();
        o.put("lat", l.getLatitude());
        o.put("lon", l.getLongitude());
        o.put("time", l.getTime());
        o.put("age_ms", System.currentTimeMillis() - l.getTime());
        if (l.hasAccuracy()) o.put("accuracy", Math.round(l.getAccuracy() * 10f) / 10.0);
        if (l.hasSpeed()) o.put("speed", Math.round(l.getSpeed() * 10f) / 10.0);
        o.put("provider", l.getProvider());
        boolean mock = Build.VERSION.SDK_INT >= 31 ? l.isMock() : l.isFromMockProvider();
        o.put("mock", mock);
        return o;
    }

    /** The receiver's gain per system and band. It drops sharply when a jammer floods the band. */
    @SuppressWarnings("deprecation")
    private void readAgc(GnssMeasurementsEvent event) {
        try {
            JSONArray out = new JSONArray();
            if (Build.VERSION.SDK_INT >= 33) {
                for (android.location.GnssAutomaticGainControl agc : event.getGnssAutomaticGainControls()) {
                    JSONObject o = new JSONObject();
                    o.put("constellation", constellationName(agc.getConstellationType()));
                    o.put("frequency_mhz", Math.round(agc.getCarrierFrequencyHz() / 100000.0) / 10.0);
                    o.put("db", Math.round(agc.getLevelDb() * 10.0) / 10.0);
                    out.put(o);
                }
            }
            if (out.length() == 0) {
                java.util.Map<String, double[]> sums = new java.util.HashMap<>();
                for (GnssMeasurement m : event.getMeasurements()) {
                    if (!m.hasAutomaticGainControlLevelDb()) continue;
                    double mhz = m.hasCarrierFrequencyHz() ? Math.round(m.getCarrierFrequencyHz() / 1e6) : 0;
                    String key = constellationName(m.getConstellationType()) + "|" + mhz;
                    double[] acc = sums.get(key);
                    if (acc == null) { acc = new double[2]; sums.put(key, acc); }
                    acc[0] += m.getAutomaticGainControlLevelDb();
                    acc[1] += 1;
                }
                for (java.util.Map.Entry<String, double[]> e : sums.entrySet()) {
                    String[] parts = e.getKey().split("\\|");
                    JSONObject o = new JSONObject();
                    o.put("constellation", parts[0]);
                    o.put("frequency_mhz", Double.parseDouble(parts[1]));
                    o.put("db", Math.round(e.getValue()[0] / e.getValue()[1] * 10.0) / 10.0);
                    out.put(o);
                }
            }
            agcJson = out.toString();
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
        try { locationManager.removeUpdates(networkListener); } catch (Exception ignored) { }
        try { locationManager.unregisterGnssMeasurementsCallback(measurementsCallback); } catch (Exception ignored) { }
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

    @JavascriptInterface public String cancelK69Alerts() {
        try {
            K69Scheduler.cancelAll(activity);
            return "ok";
        } catch (Exception error) {
            return "לא ניתן לבטל התראות Android: " + error.getClass().getSimpleName();
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
        if (seconds == 300) return "הגיע הזמן להדליק איגי";
        if (seconds == 0) return "מפתח קיי הגיע עכשיו";
        if (seconds == 60) return "בעוד דקה יגיע המפתח";
        if (seconds == 30) return "בעוד שלושים שניות יגיע המפתח";
        if (seconds == 10) return "בעוד עשר שניות יגיע המפתח";
        return "בעוד " + seconds + " שניות יגיע המפתח";
    }

    void resumePendingInstall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !activity.getPackageManager().canRequestPackageInstalls()) return;
        SharedPreferences prefs = activity.getSharedPreferences("haniaion_updates", Context.MODE_PRIVATE);
        long downloadId = prefs.getLong("pending_install_id", -1L);
        if (downloadId == -1L) return;
        try {
            DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            Uri apkUri = manager.getUriForDownloadedFile(downloadId);
            if (apkUri == null) return;
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(install);
            prefs.edit().remove("pending_install_id").apply();
        } catch (Exception error) {
            Toast.makeText(activity, "לא ניתן לפתוח את מתקין העדכון", Toast.LENGTH_LONG).show();
        }
    }

    void onResume() { updateManager.onResume(); }
    void onPause() { updateManager.onPause(); }

    void shutdown() {
        stopBackgroundWatch();
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

    @JavascriptInterface public void openUpdate(String url, int targetVersionCode) {
        activity.runOnUiThread(() -> updateManager.start(url, targetVersionCode));
    }

    @JavascriptInterface public int updateProgress() { return updateManager.progress(); }

    @JavascriptInterface public String updateState() {
        return updateManager.state();
    }
}
