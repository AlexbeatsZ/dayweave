package org.dayweave.mobile;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.os.Build;
import android.os.Process;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class UsageCapture {
    static boolean allowed(Context context) {
        AppOpsManager manager=(AppOpsManager)context.getSystemService(Context.APP_OPS_SERVICE);
        return manager.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,Process.myUid(),context.getPackageName())==AppOpsManager.MODE_ALLOWED;
    }
    static JSONObject event(UsageDatabase database,String kind,String identity,long start,long end,String app,String title,String url) throws Exception {
        String device=database.deviceId();
        return new JSONObject().put("id","dayweave:"+device+":"+kind+":"+identity).put("deviceId","dayweave:"+device).put("deviceName",Build.MANUFACTURER+" "+Build.MODEL)
            .put("platform","android").put("source","dayweave").put("kind",kind).put("start",start).put("end",end).put("app",app).put("title",title).put("url",url).put("category","").put("revision",System.currentTimeMillis()).put("deleted",false);
    }
    static boolean filter(JSONObject event,JSONObject settings) throws Exception {
        return filter(event,settings,"");
    }
    static boolean filter(JSONObject event,JSONObject settings,String packageName) throws Exception {
        String app=(event.getString("app")+" "+packageName).toLowerCase(Locale.ROOT),title=event.getString("title").toLowerCase(Locale.ROOT),url=event.getString("url").toLowerCase(Locale.ROOT);
        JSONArray excluded=settings.getJSONArray("excludedApps");for(int index=0;index<excluded.length();index++)if(app.contains(excluded.getString(index).toLowerCase(Locale.ROOT)))return false;
        excluded=settings.getJSONArray("excludedDomains");for(int index=0;index<excluded.length();index++){String domain=excluded.getString(index).toLowerCase(Locale.ROOT);try{String host=java.net.URI.create(url.contains("://")?url:"https://"+url).getHost();if(host!=null&&(host.equals(domain)||host.endsWith("."+domain)))return false;}catch(Exception ignored){}}
        excluded=settings.getJSONArray("excludedKeywords");for(int index=0;index<excluded.length();index++)if((title+" "+url).contains(excluded.getString(index).toLowerCase(Locale.ROOT))){event.put("title","").put("url","");break;}
        return true;
    }
    static synchronized void collect(Context context) throws Exception {
        try(UsageDatabase database=new UsageDatabase(context)) {
            JSONObject settings=database.settings();if(!settings.getBoolean("enabled")||!allowed(context))return;
            long now=System.currentTimeMillis(),first=Long.parseLong(database.meta("captureSince","0"));
            if(first==0){first=now;database.meta("captureSince",String.valueOf(first),database.getWritableDatabase());}
            long previous=Long.parseLong(database.meta("lastScan",String.valueOf(first)));
            long since=Math.max(first,previous-7L*86400000);
            UsageStatsManager manager=(UsageStatsManager)context.getSystemService(Context.USAGE_STATS_SERVICE);
            UsageEvents usage=manager.queryEvents(since,now);if(usage==null)throw new IllegalStateException("使用情况数据暂不可用，请解锁后重试");
            List<UsageSessions.Event> events=new ArrayList<>();JSONArray stored=new JSONArray();
            while(usage.hasNextEvent()) {
                UsageEvents.Event item=new UsageEvents.Event();usage.getNextEvent(item);
                events.add(new UsageSessions.Event(item.getTimeStamp(),item.getEventType(),item.getPackageName()));
                if(item.getEventType()==18)stored.put(event(database,"unlock",String.valueOf(item.getTimeStamp()),item.getTimeStamp(),item.getTimeStamp(),"","",""));
            }
            for(UsageSessions.Session session:UsageSessions.build(events,now)) {
                if(context.getPackageName().equals(session.app))continue;
                String label=session.app;try{label=context.getPackageManager().getApplicationLabel(context.getPackageManager().getApplicationInfo(session.app,0)).toString();}catch(Exception ignored){}
                JSONObject record=event(database,"app",session.app+":"+session.start,session.start,session.end,label,"","");
                if(filter(record,settings,session.app))stored.put(record);
            }
            database.insert(stored);database.meta("lastScan",String.valueOf(now),database.getWritableDatabase());
        }
    }
}
