package org.dayweave.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.AtomicFile;
import android.util.Log;

import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Phone side of the Xiaomi watch quick app (docs/design/watch.md). Gadgetbridge relays the watch's
 * interconnect messages here; requests go to the hub's /watch exchange with the existing pairing
 * key. Without the hub, views come from the snapshot written on every save and commands wait in an
 * outbox until the network returns.
 */
public final class WatchBridge extends BroadcastReceiver {
    static final String RECEIVED = "nodomain.freeyourgadget.gadgetbridge.WATCH_APP_MESSAGE_RECEIVED";
    static final String SEND = "nodomain.freeyourgadget.gadgetbridge.command.SEND_WATCH_APP_MESSAGE";
    static final String GADGETBRIDGE = "nodomain.freeyourgadget.gadgetbridge";
    static final String APP = "org.dayweave.mobile";
    private static final String SNAPSHOT = "watch-view.json";
    private static final String OUTBOX = "watch-outbox.json";
    private static final int MAX_PAYLOAD = 4000;
    private static final int MAX_OUTBOX = 64;
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!RECEIVED.equals(intent.getAction()) || !APP.equals(intent.getStringExtra("appId"))) return;
        String device = intent.getStringExtra("device"), payload = intent.getStringExtra("payload");
        if (device == null || payload == null || payload.length() > MAX_PAYLOAD) return;
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        WORKER.execute(() -> {
            try {
                reply(app, device, answer(app, new JSONObject(payload)));
            } catch (Exception error) {
                Log.w("Dayweave", "Watch request was not answered", error);
            } finally {
                pending.finish();
            }
        });
    }

    static JSONObject answer(Context context, JSONObject request) throws Exception {
        String id = request.optString("id"), op = request.optString("op");
        boolean command = !"view".equals(op);
        if (command) queue(context, request);
        try {
            JSONObject reply = exchange(context, request);
            if (command) dequeue(context, id);
            return reply;
        } catch (Exception offline) {
            Log.i("Dayweave", "Watch hub unreachable: " + offline.getMessage());
            if (command) {
                schedule(context);
                return failure(id, "offline", "已保存，联网后同步");
            }
            JSONObject view = snapshot(context);
            if (view == null) return failure(id, "offline", "中心不可达，请打开手机 Dayweave");
            return view.put("v", 1).put("re", id).put("ok", true).put("stale", true);
        }
    }

    static JSONObject failure(String id, String code, String message) throws Exception {
        return new JSONObject().put("v", 1).put("re", id).put("ok", false).put("err", code).put("msg", message);
    }

    private static void reply(Context context, String device, JSONObject reply) {
        context.sendBroadcast(new Intent(SEND).setPackage(GADGETBRIDGE)
                .putExtra("device", device).putExtra("appId", APP).putExtra("payload", reply.toString()));
    }

    /** One encrypted /watch exchange with the paired hub, trying each configured address. */
    static JSONObject exchange(Context context, JSONObject request) throws Exception {
        File file = new File(context.getFilesDir(), "sync.json");
        if (!file.exists()) throw new IllegalStateException("尚未配对中心");
        JSONObject config = new JSONObject(new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8));
        if (!config.optBoolean("enabled") || !config.has("key") || !config.has("hubId"))
            throw new IllegalStateException("尚未配对中心");
        String key = config.getString("key"), id = config.getString("deviceId");
        List<String> addresses = UsageSync.endpoints(config);
        return SyncEndpoint.first(addresses, endpoint -> post(endpoint, request, key, id));
    }

    private static JSONObject post(String endpoint, JSONObject request, String key, String id) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint + "/watch").openConnection();
        try {
            // Gadgetbridge's receiver must finish well inside the broadcast deadline.
            connection.setConnectTimeout(2500);
            connection.setReadTimeout(4000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] bytes = UsageSync.seal(request, key, id, "/watch").toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {output.write(bytes);}
            int status = connection.getResponseCode();
            if (status != 200) throw new IllegalStateException(status == 403 ? "中心尚未支持手表" : "中心返回 " + status);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > 64 * 1024) throw new IllegalStateException("中心回执过大");
                    output.write(buffer, 0, count);
                }
                JSONObject reply = UsageSync.open(new JSONObject(output.toString("UTF-8")), key, id, "/watch");
                if (!request.optString("id").equals(reply.optString("re"))) throw new IllegalStateException("中心回执不匹配");
                return reply;
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Called after every save; the snapshot is a projection and must never fail the save. */
    static void saveSnapshot(Context context, String view) {
        if (view == null) return;
        try {
            write(context, SNAPSHOT, view);
        } catch (Exception error) {
            Log.w("Dayweave", "Watch snapshot was not saved", error);
        }
    }

    private static JSONObject snapshot(Context context) {
        try {
            String text = read(context, SNAPSHOT);
            return text == null ? null : new JSONObject(text);
        } catch (Exception error) {
            return null;
        }
    }

    static synchronized void queue(Context context, JSONObject command) throws Exception {
        JSONArray outbox = outbox(context), next = new JSONArray();
        for (int index = 0; index < outbox.length(); index++)
            if (!command.optString("id").equals(outbox.getJSONObject(index).optString("id"))) next.put(outbox.get(index));
        next.put(command);
        // Keep the newest commands; the hub rejects week-old ones anyway.
        JSONArray kept = new JSONArray();
        for (int index = Math.max(0, next.length() - MAX_OUTBOX); index < next.length(); index++) kept.put(next.get(index));
        write(context, OUTBOX, kept.toString());
    }

    static synchronized void dequeue(Context context, String id) throws Exception {
        JSONArray outbox = outbox(context), next = new JSONArray();
        for (int index = 0; index < outbox.length(); index++)
            if (!id.equals(outbox.getJSONObject(index).optString("id"))) next.put(outbox.get(index));
        write(context, OUTBOX, next.toString());
    }

    static synchronized JSONArray outbox(Context context) throws Exception {
        String text = read(context, OUTBOX);
        return text == null ? new JSONArray() : new JSONArray(text);
    }

    private static String read(Context context, String name) throws Exception {
        File file = new File(context.getFilesDir(), name);
        return file.exists() ? new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8) : null;
    }

    private static void write(Context context, String name, String text) throws Exception {
        AtomicFile file = new AtomicFile(new File(context.getFilesDir(), name));
        FileOutputStream output = file.startWrite();
        try {
            output.write(text.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (Exception error) {
            file.failWrite(output);
            throw error;
        }
    }

    static void schedule(Context context) {
        WorkManager.getInstance(context).enqueueUniqueWork("dayweave-watch-outbox", ExistingWorkPolicy.KEEP,
                new OneTimeWorkRequest.Builder(Outbox.class)
                        .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                        .build());
    }

    /** Replays queued watch commands in order; any hub answer, accepted or rejected, settles one. */
    public static final class Outbox extends Worker {
        public Outbox(Context context, WorkerParameters parameters) {super(context, parameters);}

        @Override
        public Result doWork() {
            Context context = getApplicationContext();
            try {
                JSONArray outbox = outbox(context);
                for (int index = 0; index < outbox.length(); index++) {
                    JSONObject command = outbox.getJSONObject(index);
                    exchange(context, command);
                    dequeue(context, command.optString("id"));
                }
                return Result.success();
            } catch (Exception error) {
                Log.i("Dayweave", "Watch outbox waits for the hub: " + error.getMessage());
                return Result.retry();
            }
        }
    }
}
