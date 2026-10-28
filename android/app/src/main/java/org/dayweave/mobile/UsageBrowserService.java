package org.dayweave.mobile;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.app.KeyguardManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public final class UsageBrowserService extends AccessibilityService {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private String browser=null,url=null;
    private long start=0,lastObserved=0;
    private final Runnable tick=new Runnable(){@Override public void run(){observe();handler.postDelayed(this,2000);}};
    @Override protected void onServiceConnected(){handler.post(tick);UsageWorker.schedule(this);}
    @Override public void onAccessibilityEvent(AccessibilityEvent event){observe();}
    private void observe() {
        long now=System.currentTimeMillis();
        if(now-lastObserved<500)return;
        if(now-lastObserved>30000)finish(lastObserved);
        lastObserved=now;
        AccessibilityNodeInfo root=getRootInActiveWindow();
        try(UsageDatabase database=new UsageDatabase(this)) {
            JSONObject settings=database.settings();
            if(!settings.getBoolean("enabled")||!settings.getBoolean("browser")||!((PowerManager)getSystemService(POWER_SERVICE)).isInteractive()||((KeyguardManager)getSystemService(KEYGUARD_SERVICE)).isKeyguardLocked()||root==null){finish(now);return;}
            String app=root.getPackageName()==null?"":root.getPackageName().toString();
            boolean via=app.equals("mark.via")||app.equals("mark.via.gp");
            if(!via&&!app.equals("com.android.chrome")&&!app.equals("com.microsoft.emmx")&&!app.equals("com.brave.browser")&&!app.equals("org.mozilla.firefox")){finish(now);return;}
            List<AccessibilityNodeInfo> nodes=new ArrayList<>();collect(root,nodes,0);
            boolean web=false;for(AccessibilityNodeInfo node:nodes)if(String.valueOf(node.getClassName()).contains("WebView"))web=true;
            String found=null;
            for(AccessibilityNodeInfo node:nodes) {
                String resource=node.getViewIdResourceName(),className=String.valueOf(node.getClassName());
                boolean address=resource!=null&&(resource.endsWith(":id/url_bar")||resource.endsWith(":id/mozac_browser_toolbar_url_view"));
                if(via&&web&&node.isClickable()&&className.endsWith("TextView")&&!node.isEditable()) {
                    AccessibilityNodeInfo parent=node.getParent();
                    if(parent!=null) {
                        boolean toolbar="mark.via.gp:id/fm".equals(parent.getViewIdResourceName())||"mark.via:id/fm".equals(parent.getViewIdResourceName());
                        int images=0;for(int index=0;index<parent.getChildCount();index++){AccessibilityNodeInfo sibling=parent.getChild(index);if(sibling!=null&&String.valueOf(sibling.getClassName()).endsWith("ImageView"))images++;}
                        address=(toolbar||images>=2)&&nativeToolbar(node);
                    }
                }
                if(address&&!node.isFocused()) {String candidate=BrowserAddress.parse(node.getText()==null?null:node.getText().toString(),via&&node.isEditable());if(candidate!=null){found=candidate;break;}}
            }
            if(found==null){finish(now);return;}
            JSONObject observation=UsageCapture.event(database,"web","preview",now,now,app,"",found);
            if(!UsageCapture.filter(observation,settings)){finish(now);return;}
            found=observation.getString("url");if(found.isEmpty()){finish(now);return;}
            if(!app.equals(browser)||!found.equals(url)){finish(now);browser=app;url=found;start=now;}
            save(now,database);
        } catch(Exception error){try(UsageDatabase database=new UsageDatabase(this)){database.meta("error","浏览器采集暂不可用",database.getWritableDatabase());}}
    }
    private boolean nativeToolbar(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo parent=node.getParent();
        for(int depth=0;parent!=null&&depth<24;depth++,parent=parent.getParent()) {
            String name=String.valueOf(parent.getClassName());
            if(name.contains("WebView")||name.contains("ListView")||name.contains("RecyclerView")||name.contains("ScrollView"))return false;
        }
        return true;
    }
    private void collect(AccessibilityNodeInfo node,List<AccessibilityNodeInfo> result,int depth) {
        if(result.size()>=250||depth>24)return;result.add(node);
        for(int index=0;index<node.getChildCount()&&result.size()<250;index++){AccessibilityNodeInfo child=node.getChild(index);if(child!=null)collect(child,result,depth+1);}
    }
    private void save(long end,UsageDatabase database) throws Exception {
        if(url==null||end<=start)return;
        JSONObject event=UsageCapture.event(database,"web",browser+":"+start,start,end,browser,"",url);
        if(UsageCapture.filter(event,database.settings()))database.insert(new JSONArray().put(event));
    }
    private void finish(long end){if(url!=null){try(UsageDatabase database=new UsageDatabase(this)){save(end,database);}catch(Exception ignored){}url=null;browser=null;}}
    @Override public void onInterrupt(){finish(System.currentTimeMillis());}
    @Override public void onDestroy(){handler.removeCallbacks(tick);finish(System.currentTimeMillis());super.onDestroy();}
}
