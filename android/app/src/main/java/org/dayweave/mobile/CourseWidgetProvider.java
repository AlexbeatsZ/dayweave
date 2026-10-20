package org.dayweave.mobile;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.json.*;

/** Runs independently of Capacitor in Xiaomi's lightweight widgetProvider process. */
public class CourseWidgetProvider extends AppWidgetProvider {
    public static final String REFRESH="org.dayweave.mobile.REFRESH_COURSES";
    static final String MIUI_REFRESH="miui.appwidget.action.APPWIDGET_UPDATE";
    static final int MAX_BYTES=8*1024*1024;
    public static void writeSnapshot(Context context,String content) throws Exception {
        JSONObject data=new JSONObject(content);
        String snapshot=new JSONObject().put("schedule",data.getJSONObject("schedule")).toString();
        android.util.AtomicFile file=new android.util.AtomicFile(new File(context.getFilesDir(),"widget-schedule.json"));
        FileOutputStream output=file.startWrite();
        try {output.write(snapshot.getBytes(StandardCharsets.UTF_8));file.finishWrite(output);}catch(Exception error){file.failWrite(output);throw error;}
    }
    public static void requestRefresh(Context context){
        context.sendBroadcast(new Intent(context,CourseWidgetProvider.class).setAction(REFRESH));
    }
    @Override public void onReceive(Context context,Intent intent){
        String action=intent.getAction();
        if(REFRESH.equals(action)||MIUI_REFRESH.equals(action)||Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_TIME_CHANGED.equals(action)||Intent.ACTION_TIMEZONE_CHANGED.equals(action)||Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))updateAll(context);
        else super.onReceive(context,intent);
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){updateAll(context);}
    @Override public void onEnabled(Context context){updateAll(context);}
    @Override public void onDisabled(Context context){scheduleBoundary(context,0);}
    @Override public void onRestored(Context context,int[] oldIds,int[] newIds){updateAll(context);}
    @Override public void onAppWidgetOptionsChanged(Context context,AppWidgetManager manager,int id,Bundle options){
        if(options.getBoolean("miuiIdChanged")&&!options.getBoolean("miuiIdChangedComplete")){
            options.putBoolean("miuiIdChangedComplete",true);manager.updateAppWidgetOptions(id,options);
        }
        updateAll(context);
    }
    static Set<String> strings(JSONArray array) throws JSONException{
        Set<String> result=new HashSet<>();if(array!=null)for(int i=0;i<array.length();i++)result.add(array.getString(i));return result;
    }
    static JSONObject read(Context context) throws Exception{
        // Read only committed files. AtomicFile.openRead can roll back an active writer.
        File main=new File(context.getFilesDir(),"widget-schedule.json");
        if(!main.exists())main=new File(context.getFilesDir(),"widget-schedule.json.bak");
        if(!main.exists())return null;
        try(InputStream input=new FileInputStream(main);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int count;
            while((count=input.read(buffer))!=-1){if(bytes.size()+count>MAX_BYTES)throw new IOException("Data too large");bytes.write(buffer,0,count);}
            return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
        }
    }
    public static void updateAll(Context context){
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        int[] wide=manager.getAppWidgetIds(new ComponentName(context,CourseWidgetProvider.class));
        int[] small=manager.getAppWidgetIds(new ComponentName(context,CompactCourseWidgetProvider.class));
        if(wide.length+small.length==0){scheduleBoundary(context,0);return;}
        long now=System.currentTimeMillis(),boundary=0;JSONObject data=null,schedule=null;List<CourseSchedule.Event> events=new ArrayList<>();String zone="Asia/Shanghai",error=null;
        try{
            data=read(context);if(data!=null){
                schedule=data.getJSONObject("schedule");zone=schedule.getString("timeZone");
                JSONArray raw=schedule.getJSONArray("courses"),fixed=schedule.getJSONArray("events");List<CourseSchedule.Course> courses=new ArrayList<>();
                if(raw.length()>2000||fixed.length()>15000)throw new IOException("Invalid course count");
                for(int i=0;i<raw.length();i++){
                    JSONObject c=raw.getJSONObject(i);JSONArray weeks=c.getJSONArray("weeks");int[] w=new int[weeks.length()];
                    if(w.length>60)throw new IOException("Invalid weeks");for(int j=0;j<w.length;j++)w[j]=weeks.getInt(j);
                    courses.add(new CourseSchedule.Course(c.getString("name"),c.optString("location"),c.optString("teacher"),c.getInt("weekday"),c.getString("start"),c.getString("end"),w,strings(c.optJSONArray("excludedDates"))));
                }
                for(int i=0;i<fixed.length();i++){JSONObject e=fixed.getJSONObject(i);events.add(new CourseSchedule.Event(e.getString("name"),e.optString("location"),e.optString("teacher"),e.getString("timeZone"),e.getLong("start"),e.getLong("end")));}
                events=CourseSchedule.expand(schedule.getString("semesterStart"),zone,courses,events,strings(schedule.optJSONArray("holidays")),now);
            }
        }catch(Exception e){error="请打开时织检查课程数据";}
        CourseSchedule.Event current=CourseSchedule.current(events,now),next=CourseSchedule.next(events,now),item=current!=null?current:next;
        if(item!=null)boundary=current!=null?item.end:item.start;
        for(CourseSchedule.Event e:events){if(e.start>now&&(boundary==0||e.start<boundary))boundary=e.start;if(e.end>now&&(boundary==0||e.end<boundary))boundary=e.end;}
        for(int kind=0;kind<2;kind++)for(int id:kind==0?wide:small){
            RemoteViews views=new RemoteViews(context.getPackageName(),kind==0?R.layout.course_widget:R.layout.course_widget_compact);
            views.setTextViewText(R.id.widget_status,current!=null?"正在上课":"下一节课");
            views.setTextViewText(R.id.widget_title,error!=null?error:item!=null?item.name:data==null?"打开时织，导入课程":"接下来没有课程");
            views.setTextViewText(R.id.widget_time,item!=null?format(item.start,zone,"MM-dd HH:mm")+"–"+format(item.end,zone,"HH:mm"):"待办 · 时间 · 课程");
            views.setTextViewText(R.id.widget_location,item!=null?(item.location.isEmpty()?"未填写教室":item.location):"点击打开课程表");
            views.setTextViewText(R.id.widget_zone,zone);
            views.setViewVisibility(R.id.widget_countdown,item==null?View.GONE:View.VISIBLE);
            if(item!=null){views.setChronometer(R.id.widget_countdown,SystemClock.elapsedRealtime()+Math.max(0,(current!=null?item.end:item.start)-now),current!=null?"%s 后下课":"%s 后上课",true);views.setChronometerCountDown(R.id.widget_countdown,true);}
            if(kind==0){
                String local=item==null?"":ZoneId.systemDefault().getId().equals(zone)?item.teacher:"设备 "+format(item.start,ZoneId.systemDefault().getId(),"MM-dd HH:mm");
                if(current!=null&&next!=null)local="下一节 "+format(next.start,zone,"HH:mm")+" "+next.name;
                views.setTextViewText(R.id.widget_secondary,local);
            }
            Intent launch=new Intent(context,MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("dayweave://timetable")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
            views.setOnClickPendingIntent(android.R.id.background,PendingIntent.getActivity(context,100,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            manager.updateAppWidget(id,views);
        }
        scheduleBoundary(context,boundary);
    }
    static String format(long instant,String zone,String pattern){return Instant.ofEpochMilli(instant).atZone(ZoneId.of(zone)).format(DateTimeFormatter.ofPattern(pattern));}
    static void scheduleBoundary(Context context,long at){
        AlarmManager alarms=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending=PendingIntent.getBroadcast(context,201,new Intent(context,CourseWidgetProvider.class).setAction(REFRESH),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        alarms.cancel(pending);
        if(at>0)alarms.set(AlarmManager.RTC,Math.max(at+1000,System.currentTimeMillis()+1000),pending);
    }
}
