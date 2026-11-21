package org.dayweave.mobile;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

/** A device-local projection of the saved running timer. The receiver only alerts. */
public final class CountdownReminder extends BroadcastReceiver {
    private static final String PREFS = "countdown_reminder";
    static final String CHANNEL = "countdown";
    private static final String EXPIRED = "org.dayweave.mobile.COUNTDOWN_EXPIRED";
    private static final int NOTIFICATION_ID = 1;

    record Deadline(String id, long at, String activity) {
        static Deadline from(JSONObject value) {
            if (value == null) return null;
            String id = value.optString("id", "");
            long at = value.optLong("at", 0);
            return id.isEmpty() || at <= 0 ? null : new Deadline(id, at, value.optString("activity", "活动"));
        }

        boolean sameTime(Deadline other) {
            return other != null && id.equals(other.id) && at == other.at;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static Deadline pending(SharedPreferences prefs) {
        String id = prefs.getString("id", null);
        return id == null ? null : new Deadline(id, prefs.getLong("at", 0), prefs.getString("activity", "活动"));
    }

    private static SharedPreferences.Editor clearPending(SharedPreferences prefs) {
        return prefs.edit().remove("id").remove("at").remove("activity");
    }

    private static Intent alarmIntent(Context context) {
        return new Intent(context, CountdownReminder.class).setAction(EXPIRED);
    }

    private static void cancel(Context context) {
        PendingIntent alarm = PendingIntent.getBroadcast(context, 0, alarmIntent(context),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (alarm != null) {
            context.getSystemService(AlarmManager.class).cancel(alarm);
            alarm.cancel();
        }
    }

    static boolean exactAllowed(Context context) {
        return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    static boolean notificationsAllowed(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel channel = context.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private static void schedule(Context context, Deadline deadline) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        Intent intent = alarmIntent(context).putExtra("id", deadline.id()).putExtra("at", deadline.at());
        PendingIntent alarm = PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try {
            if (exactAllowed(context)) {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deadline.at(), alarm);
                return;
            }
        } catch (SecurityException error) {
            // Exact-alarm access can be revoked between checking it and scheduling.
            Log.w("Dayweave", "Exact countdown alarm unavailable", error);
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deadline.at(), alarm);
    }

    static synchronized void update(Context context, Deadline next, Deadline completed, boolean restoring) {
        SharedPreferences prefs = prefs(context);
        Deadline current = pending(prefs);
        if (current != null && current.sameTime(completed) && current.at() <= System.currentTimeMillis()) {
            show(context, prefs, current);
            current = null;
        }
        // A cold load may recover an overdue timer already handled by the OS. Keep an existing
        // alarm for that timer, but don't create a new reminder from a historical snapshot.
        if (restoring && next != null && next.at() <= System.currentTimeMillis()
                && !next.sameTime(current)) next = null;
        if (next != null && next.id().equals(prefs.getString("deliveredId", null))
                && next.at() == prefs.getLong("deliveredAt", 0)) next = null;
        if (next == null) {
            cancel(context);
            if (current != null) clearPending(prefs).commit();
        } else if (restoring || !next.equals(current)) {
            prefs.edit().putString("id", next.id()).putLong("at", next.at())
                    .putString("activity", next.activity()).commit();
            schedule(context, next);
        }
    }

    static synchronized void rearm(Context context) {
        Deadline current = pending(prefs(context));
        if (current != null) schedule(context, current);
    }

    private static void show(Context context, SharedPreferences prefs, Deadline deadline) {
        // The foreground save and the OS alarm may arrive in either order.
        clearPending(prefs).putString("deliveredId", deadline.id())
                .putLong("deliveredAt", deadline.at()).commit();
        cancel(context);
        if (!notificationsAllowed(context)) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL, "倒计时提醒", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(context, MainActivity.class).setAction(Intent.ACTION_MAIN);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE);
        try {
            manager.notify(NOTIFICATION_ID, new NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                    .setContentTitle("倒计时结束")
                    .setContentText(deadline.activity() + "计时已结束")
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setDefaults(NotificationCompat.DEFAULT_SOUND)
                    .setAutoCancel(true)
                    .setContentIntent(tap)
                    .build());
        } catch (SecurityException error) {
            Log.w("Dayweave", "Countdown notification permission changed", error);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (!EXPIRED.equals(intent.getAction())) {
                rearm(context);
                return;
            }
            synchronized (CountdownReminder.class) {
                SharedPreferences prefs = prefs(context);
                Deadline current = pending(prefs);
                if (current == null || !current.id().equals(intent.getStringExtra("id"))
                        || current.at() != intent.getLongExtra("at", 0)) return;
                if (current.at() <= System.currentTimeMillis()) show(context, prefs, current);
                else schedule(context, current);
            }
        } catch (RuntimeException error) {
            Log.w("Dayweave", "Unable to handle countdown alarm", error);
        }
    }
}
