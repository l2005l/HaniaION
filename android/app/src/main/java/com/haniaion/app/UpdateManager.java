package com.haniaion.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import java.io.File;
import java.io.FileDescriptor;
import java.util.Arrays;

final class UpdateManager {
    private static final String PREFS = "haniaion_update";
    private static final String KEY_ID = "download_id";
    private static final String KEY_TARGET = "target_version_code";
    private static final String KEY_STATE = "state";
    private static final String STATE_DOWNLOADING = "downloading";
    private static final String STATE_READY = "ready";
    private static final String STATE_AWAITING_PERMISSION = "awaiting_install_permission";
    private static final String FILE_NAME = "HaniaION-update.apk";
    private static final String ALLOWED_PREFIX = "https://github.com/l2005l/HaniaION/releases/download/";

    private final Activity activity;
    private final DownloadManager downloads;
    private final SharedPreferences prefs;
    private BroadcastReceiver receiver;

    UpdateManager(Activity activity) {
        this.activity = activity;
        this.downloads = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void start(String url, int targetVersionCode) {
        if (url == null || !url.startsWith(ALLOWED_PREFIX) || url.contains("..")) { toast("כתובת העדכון אינה מורשית"); return; }
        if (targetVersionCode <= installedVersionCode(activity)) { toast("הגרסה המותקנת כבר מעודכנת"); return; }
        String state = prefs.getString(KEY_STATE, "");
        long existingId = prefs.getLong(KEY_ID, -1);
        int existingTarget = prefs.getInt(KEY_TARGET, 0);
        if (existingId != -1 && existingTarget == targetVersionCode) {
            int status = queryStatus(existingId)[0];
            if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_PAUSED) {
                toast("העדכון כבר בהורדה — אין צורך ללחוץ שוב"); return;
            }
            if (status == DownloadManager.STATUS_SUCCESSFUL && (STATE_READY.equals(state) || STATE_AWAITING_PERMISSION.equals(state))) {
                handleSuccessfulDownload(existingId); return;
            }
        }
        clearDownload();
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("HaniaION");
            request.setDescription("מוריד עדכון לאפליקציה…");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, FILE_NAME);
            long id = downloads.enqueue(request);
            prefs.edit().putLong(KEY_ID, id).putInt(KEY_TARGET, targetVersionCode).putString(KEY_STATE, STATE_DOWNLOADING).apply();
            toast("הורדת העדכון התחילה");
        } catch (Exception error) { clearDownload(); toast("לא ניתן להתחיל את העדכון"); }
    }

    String state() {
        long id = prefs.getLong(KEY_ID, -1);
        if (id == -1) return "idle";
        int status = queryStatus(id)[0];
        if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_PAUSED) return "downloading";
        if (status == DownloadManager.STATUS_SUCCESSFUL) return "ready";
        return "idle";
    }

    void onResume() {
        registerReceiver();
        long id = prefs.getLong(KEY_ID, -1);
        if (id == -1) return;
        String state = prefs.getString(KEY_STATE, "");
        int status = queryStatus(id)[0];
        if (STATE_DOWNLOADING.equals(state)) {
            if (status == DownloadManager.STATUS_SUCCESSFUL || status == DownloadManager.STATUS_FAILED || status == -1) onDownloadFinished(id);
        } else if (STATE_AWAITING_PERMISSION.equals(state) && canInstall()) {
            handleSuccessfulDownload(id);
        } else if (STATE_AWAITING_PERMISSION.equals(state)) {
            prefs.edit().putString(KEY_STATE, STATE_READY).apply();
            toast("לא אושרה התקנה מהאפליקציה. אפשר ללחוץ שוב על \"בדוק עדכונים\" כדי לנסות שוב");
        }
    }

    void onPause() {
        if (receiver == null) return;
        try { activity.unregisterReceiver(receiver); } catch (Exception ignored) { }
        receiver = null;
    }

    static void cleanupIfInstalled(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int target = p.getInt(KEY_TARGET, 0);
        if (target == 0 || installedVersionCode(context) < target) return;
        long id = p.getLong(KEY_ID, -1);
        if (id != -1) try { ((DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE)).remove(id); } catch (Exception ignored) { }
        deleteFile(context);
        p.edit().clear().apply();
    }

    private void registerReceiver() {
        if (receiver != null) return;
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != -1 && id == prefs.getLong(KEY_ID, -2)) onDownloadFinished(id);
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        else activity.registerReceiver(receiver, filter);
    }

    private void onDownloadFinished(long id) {
        if (!STATE_DOWNLOADING.equals(prefs.getString(KEY_STATE, ""))) return;
        int[] result = queryStatus(id);
        if (result[0] == DownloadManager.STATUS_SUCCESSFUL) {
            prefs.edit().putString(KEY_STATE, STATE_READY).apply();
            handleSuccessfulDownload(id);
        } else if (result[0] == DownloadManager.STATUS_FAILED || result[0] == -1) {
            clearDownload();
            toast("הורדת העדכון נכשלה" + reasonText(result[1]) + " — נסה שוב");
        }
    }

    private void handleSuccessfulDownload(long id) {
        Uri uri = downloads.getUriForDownloadedFile(id);
        if (uri == null) { clearDownload(); toast("קובץ העדכון לא נמצא — נסה שוב"); return; }
        String problem = verifyDownloadedApk(uri);
        if (problem != null) { clearDownload(); toast(problem); return; }
        if (!canInstall()) {
            prefs.edit().putString(KEY_STATE, STATE_AWAITING_PERMISSION).apply();
            toast("כדי להשלים את העדכון יש לאשר ל־HaniaION להתקין אפליקציות, ואז לחזור לאפליקציה");
            try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
            catch (Exception error) { toast("פתח הגדרות ← אפליקציות ← HaniaION ← התקנת אפליקציות לא מוכרות"); }
            return;
        }
        prefs.edit().putString(KEY_STATE, STATE_READY).apply();
        toast("✓ הורדת העדכון הסתיימה — אשר את ההתקנה כדי להשלים את העדכון");
        try {
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(install);
        } catch (Exception error) { toast("לא ניתן לפתוח את מסך ההתקנה — פתח את קובץ העדכון מהתראת ההורדה"); }
    }

    private String verifyDownloadedApk(Uri uri) {
        PackageManager pm = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        try (android.os.ParcelFileDescriptor pfd = activity.getContentResolver().openFileDescriptor(uri, "r")) {
            if (pfd == null || pfd.getStatSize() < 10_000) return "קובץ העדכון חסר או פגום — נסה שוב";
            String path = "/proc/self/fd/" + pfd.getFd();
            PackageInfo archive = pm.getPackageArchiveInfo(path, flags);
            if (archive == null) return "קובץ העדכון פגום — נסה שוב";
            if (!activity.getPackageName().equals(archive.packageName)) return "קובץ העדכון אינו של HaniaION";
            long archiveCode = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
            int expectedCode = prefs.getInt(KEY_TARGET, 0);
            if (expectedCode > 0 && archiveCode != expectedCode) return "גרסת קובץ העדכון אינה תואמת לגרסה שהתבקשה";
            if (archiveCode <= installedVersionCode(activity)) return "הקובץ שהורד אינו חדש מהגרסה המותקנת";
            if (Build.VERSION.SDK_INT < 28) return null;
            PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), flags);
            if (!Arrays.equals(signaturesOf(installed), signaturesOf(archive))) return "חתימת העדכון אינה תואמת — ההתקנה בוטלה";
            return null;
        } catch (Exception error) {
            return "לא ניתן לאמת את קובץ העדכון — נסה שוב";
        }
    }

    private static Signature[] signaturesOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28) {
            if (info.signingInfo == null) return new Signature[0];
            return info.signingInfo.hasMultipleSigners() ? info.signingInfo.getApkContentsSigners() : info.signingInfo.getSigningCertificateHistory();
        }
        return info.signatures == null ? new Signature[0] : info.signatures;
    }

    private boolean canInstall() { return Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls(); }

    private int[] queryStatus(long id) {
        try (Cursor c = downloads.query(new DownloadManager.Query().setFilterById(id))) {
            if (c != null && c.moveToFirst()) return new int[]{c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)), c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))};
        } catch (Exception ignored) { }
        return new int[]{-1, 0};
    }

    private static String reasonText(int reason) {
        switch (reason) {
            case DownloadManager.ERROR_INSUFFICIENT_SPACE: return " (אין מספיק מקום פנוי)";
            case DownloadManager.ERROR_HTTP_DATA_ERROR:
            case DownloadManager.ERROR_CANNOT_RESUME: return " (החיבור נקטע)";
            case DownloadManager.ERROR_TOO_MANY_REDIRECTS:
            case DownloadManager.ERROR_UNHANDLED_HTTP_CODE: return " (שגיאת שרת)";
            default: return "";
        }
    }

    private File downloadedFile() {
        File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return dir == null ? null : new File(dir, FILE_NAME);
    }

    private void clearDownload() {
        long id = prefs.getLong(KEY_ID, -1);
        if (id != -1) try { downloads.remove(id); } catch (Exception ignored) { }
        deleteFile(activity);
        prefs.edit().clear().apply();
    }

    private static void deleteFile(Context context) {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) return;
        File[] files = dir.listFiles((d, name) -> name.startsWith("HaniaION-update") && name.endsWith(".apk"));
        if (files != null) for (File f : files) f.delete();
    }

    static int installedVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) info.getLongVersionCode() : info.versionCode;
        } catch (Exception ignored) { return 0; }
    }

    private void toast(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
}
