package org.dayweave.mobile;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;

/** Saved timer changes drive privacy. No device observation is made while blocked. */
final class UsagePrivacy {
    private static boolean loaded;
    private static boolean blocked;
    private static long until;
    private static long generation;

    static synchronized long generation() { return generation; }

    static synchronized void changed(Context context, String content) throws Exception {
        JSONObject time = new JSONObject(content).getJSONObject("timelog");
        JSONArray activities = time.optJSONArray("activities");
        JSONArray timers = new JSONArray();
        if (!time.isNull("timer")) timers.put(time.optJSONObject("timer"));
        JSONArray conflicts = time.optJSONArray("conflictedTimers");
        if (conflicts != null) for (int i = 0; i < conflicts.length(); i++) timers.put(conflicts.optJSONObject(i));
        boolean next = false;
        long deadline = 0, now = System.currentTimeMillis();
        for (int i = 0; i < timers.length(); i++) {
            JSONObject timer = timers.optJSONObject(i);
            if (timer == null || activities == null) continue;
            long end = timer.isNull("plannedEndAt") || timer.isNull("runningSince") ? Long.MAX_VALUE : timer.optLong("plannedEndAt", Long.MAX_VALUE);
            if (end <= now) continue;
            for (int j = 0; j < activities.length(); j++) {
                JSONObject activity = activities.getJSONObject(j);
                String name = activity.optString("name").trim();
                if (activity.optString("id").equals(timer.optString("activityId")) && (name.equals("休息") || name.equals("娱乐"))) {
                    next = true;
                    deadline = Math.max(deadline, end);
                }
            }
        }
        UsageDatabase database = UsageDatabase.get(context);
        boolean previousBlocked = loaded ? blocked : "1".equals(database.meta("privateBlocked", "0"));
        if (next || previousBlocked != next) reset(context, now);
        database.meta("privateBlocked", next ? "1" : "0", database.getWritableDatabase());
        loaded = true;
        blocked = next;
        until = deadline;
    }

    private static void reset(Context context, long now) {
        UsageDatabase database = UsageDatabase.get(context);
        String value = String.valueOf(now);
        database.meta("captureSince", value, database.getWritableDatabase());
        database.meta("lastScan", value, database.getWritableDatabase());
        database.meta("openSince", String.valueOf(UsageSessions.OPEN_UNKNOWN), database.getWritableDatabase());
        generation++;
    }

    static synchronized boolean active(Context context) throws Exception {
        if (!loaded) {
            File file = new File(context.getFilesDir(), "data.json");
            if (file.isFile()) {
                try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    changed(context, new String(output.toByteArray(), StandardCharsets.UTF_8));
                }
            }
            else { loaded = true; blocked = false; }
        }
        if (blocked && until <= System.currentTimeMillis()) {
            blocked = false;
            reset(context, System.currentTimeMillis());
        }
        return blocked;
    }
}
