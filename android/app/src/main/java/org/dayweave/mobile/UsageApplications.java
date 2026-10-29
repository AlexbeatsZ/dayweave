package org.dayweave.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.util.TreeMap;
import org.json.JSONArray;
import org.json.JSONObject;

final class UsageApplications {
    static JSONArray list(Context context) throws Exception {
        PackageManager manager = context.getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        TreeMap<String, JSONObject> applications = new TreeMap<>();
        for (ResolveInfo item : manager.queryIntentActivities(launcher, 0)) {
            String identity = item.activityInfo.packageName;
            if (applications.containsKey(identity)) continue;
            JSONObject application = new JSONObject().put("id", identity).put("name", item.loadLabel(manager).toString());
            try {
                Drawable icon = item.loadIcon(manager);
                Bitmap bitmap = Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888);
                icon.setBounds(0, 0, 48, 48);
                icon.draw(new Canvas(bitmap));
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
                application.put("icon", "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                bitmap.recycle();
            } catch (RuntimeException ignored) {}
            applications.put(identity, application);
        }
        return new JSONArray(applications.values());
    }
}
