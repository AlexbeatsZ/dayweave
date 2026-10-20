package org.dayweave.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.util.AtomicFile;
import androidx.activity.result.ActivityResult;
import androidx.core.view.WindowCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

@CapacitorPlugin(name = "DayweaveFiles")
public class DayweaveFilesPlugin extends Plugin {
    private static final int MAX_BYTES = 50 * 1024 * 1024;
    private String exporting;

    private File file(String name) {
        if (name == null || !name.matches("^(data\\.json|data\\.backup\\.json|data\\.corrupt-[0-9]+\\.json|data\\.(json|backup\\.json)\\.before-restore-[0-9]+)$")) {
            throw new IllegalArgumentException("Unsupported data file");
        }
        return new File(getContext().getFilesDir(), name);
    }

    private String text(InputStream stream) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new FileNotFoundException("Cannot open selected file");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > MAX_BYTES) throw new IllegalArgumentException("File exceeds 50 MB");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        try {
            AtomicFile source = new AtomicFile(file(call.getString("name")));
            JSObject result = new JSObject();
            try { result.put("content", text(source.openRead())); }
            catch (FileNotFoundException missing) {
                File base = source.getBaseFile();
                if (base.exists() || new File(base.getPath() + ".bak").exists() || !base.getParentFile().canRead()) throw missing;
                result.put("content", JSONObject.NULL);
            }
            call.resolve(result);
        } catch (Exception error) { call.reject("Unable to read data", error); }
    }

    @PluginMethod
    public void write(PluginCall call) {
        FileOutputStream output = null;
        AtomicFile target = null;
        try {
            String content = call.getString("content");
            if (content == null) throw new IllegalArgumentException("Missing content");
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("File exceeds 50 MB");
            target = new AtomicFile(file(call.getString("name")));
            output = target.startWrite();
            output.write(bytes);
            target.finishWrite(output);
            output = null;
            if ("data.json".equals(call.getString("name"))) { CourseWidgetProvider.writeSnapshot(getContext(),content); CourseWidgetProvider.requestRefresh(getContext()); }
            call.resolve();
        } catch (Exception error) {
            if (output != null && target != null) target.failWrite(output);
            call.reject("Unable to save data", error);
        }
    }

    @PluginMethod
    public void pickBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "text/calendar", "text/csv", "application/octet-stream"});
        startActivityForResult(call, intent, "backupPicked");
    }

    @ActivityCallback
    private void backupPicked(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        JSObject result = new JSObject();
        Intent intent = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || intent == null || intent.getData() == null) {
            result.put("content", JSONObject.NULL); call.resolve(result); return;
        }
        try {
            result.put("content", text(getContext().getContentResolver().openInputStream(intent.getData())));
            call.resolve(result);
        } catch (Exception error) { call.reject("Unable to import selected backup", error); }
    }

    @PluginMethod
    public void exportBackup(PluginCall call) {
        if (exporting != null) { call.reject("A file picker is already open"); return; }
        String content = call.getString("content");
        if (content == null || content.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            call.reject("Invalid backup"); return;
        }
        exporting = content;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/json"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Dayweave.json"));
        startActivityForResult(call, intent, "backupExported");
    }

    @ActivityCallback
    private void backupExported(PluginCall call, ActivityResult activityResult) {
        if (call == null) { exporting = null; return; }
        String content = exporting;
        exporting = null;
        Intent intent = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || intent == null || intent.getData() == null) {
            call.resolve(new JSObject().put("saved", false)); return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(intent.getData(), "wt")) {
            if (output == null || content == null) throw new IllegalStateException("Cannot write selected file");
            output.write(content.getBytes(StandardCharsets.UTF_8)); output.flush();
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception error) { call.reject("Unable to export backup", error); }
    }

    @PluginMethod
    public void pinWidget(PluginCall call) {
        android.appwidget.AppWidgetManager manager=android.appwidget.AppWidgetManager.getInstance(getContext());
        boolean supported=false, requested=false;
        if(android.os.Build.VERSION.SDK_INT>=26) {
            supported=manager.isRequestPinAppWidgetSupported();
            requested=supported && manager.requestPinAppWidget(new android.content.ComponentName(getContext(), CourseWidgetProvider.class), null, null);
        }
        call.resolve(new JSObject().put("supported",supported).put("requested",requested));
    }

    @PluginMethod
    public void appearance(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            var window = getActivity().getWindow();
            var controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
            getBridge().getWebView().setBackgroundColor(Color.parseColor(dark ? "#18221f" : "#fafcfb"));
            call.resolve();
        });
    }
}
