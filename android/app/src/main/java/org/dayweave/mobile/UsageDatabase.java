package org.dayweave.mobile;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

final class UsageDatabase extends SQLiteOpenHelper {
    UsageDatabase(Context context) { super(context, "usage.db", null, 1); setWriteAheadLoggingEnabled(true); }
    @Override public void onCreate(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE usage_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,device TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,payload TEXT NOT NULL,pending INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0)");
        database.execSQL("CREATE INDEX usage_time ON usage_events(start,end)");
        database.execSQL("CREATE INDEX usage_pending ON usage_events(pending,seq)");
        database.execSQL("CREATE TABLE usage_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) { throw new IllegalStateException("Unsupported usage database upgrade"); }
    String meta(String key, String fallback) {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT value FROM usage_meta WHERE key=?", new String[]{key})) { return cursor.moveToFirst() ? cursor.getString(0) : fallback; }
    }
    void meta(String key, String value, SQLiteDatabase database) { database.execSQL("INSERT OR REPLACE INTO usage_meta VALUES(?,?)", new Object[]{key,value}); }
    String deviceId() {
        SQLiteDatabase database = getWritableDatabase(); database.beginTransaction();
        try { String id = meta("deviceId", ""); if (id.isEmpty()) { id = UUID.randomUUID().toString(); meta("deviceId", id, database); } database.setTransactionSuccessful(); return id; } finally { database.endTransaction(); }
    }
    static JSONObject defaults() throws Exception {
        return new JSONObject().put("enabled", false).put("sampleSeconds", 10).put("idleMinutes", 5).put("browser", false)
            .put("excludedApps", new JSONArray("[\"1Password\",\"Bitwarden\",\"Keychain\"]")).put("excludedDomains", new JSONArray()).put("excludedKeywords", new JSONArray("[\"bank\",\"login\",\"password\",\"密码\",\"银行\",\"支付\"]"));
    }
    JSONObject settings() throws Exception { return new JSONObject(meta("settings", defaults().toString())); }
    void configure(JSONObject settings) throws Exception {
        if (settings.getInt("sampleSeconds") < 2 || settings.getInt("sampleSeconds") > 300 || settings.getInt("idleMinutes") < 1 || settings.getInt("idleMinutes") > 120) throw new IllegalArgumentException("Invalid capture settings");
        for (String key : new String[]{"excludedApps","excludedDomains","excludedKeywords"}) if(settings.getJSONArray(key).length()>200) throw new IllegalArgumentException("Too many privacy rules");
        SQLiteDatabase database = getWritableDatabase(); database.beginTransaction();
        try {
            if (settings.getBoolean("enabled") && !settings().getBoolean("enabled")) {
                String now = String.valueOf(System.currentTimeMillis());
                meta("captureSince", now, database); meta("lastScan", now, database);
            }
            meta("settings", settings.toString(), database); database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
    }
    boolean put(JSONObject event, boolean pending, SQLiteDatabase database) throws Exception {
        validate(event);
        try (Cursor cursor = database.rawQuery("SELECT payload FROM usage_events WHERE id=?", new String[]{event.getString("id")})) {
            if (cursor.moveToFirst()) {
                JSONObject old = new JSONObject(cursor.getString(0));
                boolean same = true;
                for (String key : new String[]{"deviceId","deviceName","platform","source","kind","start","end","app","title","url","category","deleted"}) if (!String.valueOf(old.opt(key)).equals(String.valueOf(event.opt(key)))) same = false;
                if (same || old.getLong("revision") >= event.getLong("revision")) return false;
            }
        }
        database.execSQL("INSERT OR REPLACE INTO usage_events(id,device,start,end,payload,pending,deleted) VALUES(?,?,?,?,?,?,?)", new Object[]{event.getString("id"),event.getString("deviceId"),event.getLong("start"),event.getLong("end"),event.toString(),pending?1:0,event.optBoolean("deleted")?1:0});
        return true;
    }
    static void validate(JSONObject event) throws Exception {
        for (String key : new String[]{"id","deviceId","deviceName","platform","source","kind","app","title","url","category"}) if (!event.has(key) || event.getString(key).length()>16384) throw new IllegalArgumentException("Invalid usage event");
        long start=event.getLong("start"),end=event.getLong("end");
        if(start<0 || end<start || end>32503680000000L || end-start>366L*86400000 || event.getLong("revision")<0 || event.getString("id").isEmpty() || event.getString("id").length()>600)throw new IllegalArgumentException("Invalid usage interval");
        for(String key:new String[]{"deviceId","deviceName"})if(event.getString(key).isEmpty()||event.getString(key).length()>200)throw new IllegalArgumentException("Invalid usage device");
        if(event.getString("platform").length()>40||event.getString("category").length()>128||event.getString("app").length()>512||!java.util.Arrays.asList("activitywatch","work-review","dayweave").contains(event.getString("source")))throw new IllegalArgumentException("Invalid usage source");
        if(!java.util.Arrays.asList("app","web","unlock","media").contains(event.getString("kind")))throw new IllegalArgumentException("Invalid usage kind");
    }
    int insert(JSONArray events) throws Exception {
        if(events.length()>100000)throw new IllegalArgumentException("Too many usage events");
        SQLiteDatabase database=getWritableDatabase();database.beginTransaction();int changed=0;
        try { for(int index=0;index<events.length();index++)if(put(events.getJSONObject(index),true,database))changed++;database.setTransactionSuccessful();return changed; } finally { database.endTransaction(); }
    }
    JSONObject query(JSONObject query) throws Exception {
        long start=query.getLong("start"),end=query.getLong("end");int limit=Math.min(5000,Math.max(1,query.optInt("limit",500)));
        if(start<0 || end<=start || end-start>366L*86400000)throw new IllegalArgumentException("Invalid query range");
        String device=query.optString("deviceId",""),search=query.optString("search","").toLowerCase(java.util.Locale.ROOT);
        JSONArray events=new JSONArray();long next=0;boolean more=false;
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT seq,payload FROM usage_events WHERE deleted=0 AND start<? AND end>=? AND (?='' OR device=?) AND seq<? AND (?='' OR instr(lower(payload),?)>0) ORDER BY seq DESC LIMIT ?",new String[]{String.valueOf(end),String.valueOf(start),device,device,String.valueOf(query.optLong("before",Long.MAX_VALUE)),search,search,String.valueOf(limit+1)})) {
            while(cursor.moveToNext()) { JSONObject event=new JSONObject(cursor.getString(1));if(event.optBoolean("deleted"))continue;if(events.length()==limit){more=true;break;}events.put(event);next=cursor.getLong(0); }
        }
        JSONObject result=new JSONObject().put("events",events).put("complete",!more);if(more)result.put("next",next);return result;
    }
    JSONArray pending() throws Exception {
        JSONArray events=new JSONArray();try(Cursor cursor=getReadableDatabase().rawQuery("SELECT payload FROM usage_events WHERE pending=1 ORDER BY seq LIMIT 300",null)){while(cursor.moveToNext())events.put(new JSONObject(cursor.getString(0)));}return events;
    }
    void receive(String hub,JSONObject reply) throws Exception {
        JSONArray accepted=reply.getJSONArray("accepted"),events=reply.getJSONArray("events");
        if(accepted.length()>500||events.length()>500||reply.getLong("cursor")<0)throw new IllegalArgumentException("Invalid receipt");
        SQLiteDatabase database=getWritableDatabase();database.beginTransaction();
        try {
            for(int index=0;index<accepted.length();index++){JSONObject item=accepted.getJSONObject(index);try(Cursor cursor=database.rawQuery("SELECT payload FROM usage_events WHERE id=?",new String[]{item.getString("id")})){if(cursor.moveToFirst()&&new JSONObject(cursor.getString(0)).getLong("revision")==item.getLong("revision"))database.execSQL("UPDATE usage_events SET pending=0 WHERE id=?",new Object[]{item.getString("id")});}}
            for(int index=0;index<events.length();index++)put(events.getJSONObject(index),false,database);
            meta("cursor:"+hub,String.valueOf(reply.getLong("cursor")),database);meta("lastSync",String.valueOf(System.currentTimeMillis()),database);database.setTransactionSuccessful();
        } finally {database.endTransaction();}
    }
    JSONObject status(String capture,String error) throws Exception {
        JSONArray devices=new JSONArray();int count=0,pending=0;
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT COALESCE(SUM(1-deleted),0),SUM(pending) FROM usage_events",null)){if(cursor.moveToFirst()){count=cursor.getInt(0);pending=cursor.getInt(1);}}
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT device,MAX(end),payload FROM usage_events WHERE deleted=0 GROUP BY device",null)){while(cursor.moveToNext()){JSONObject event=new JSONObject(cursor.getString(2));devices.put(new JSONObject().put("id",cursor.getString(0)).put("name",event.getString("deviceName")).put("platform",event.getString("platform")).put("lastEvent",cursor.getLong(1)));}}
        return new JSONObject().put("settings",settings()).put("capture",capture).put("error",error).put("count",count).put("pending",pending).put("devices",devices).put("lastSync",Long.parseLong(meta("lastSync","0")));
    }
}
