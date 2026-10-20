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
    private final java.util.concurrent.ExecutorService network = java.util.concurrent.Executors.newSingleThreadExecutor();
    private boolean discovering = false;

    private String endpoint(String value) throws Exception {
        java.net.URI uri = new java.net.URI(value);
        String host=uri.getHost();
        if(!"http".equals(uri.getScheme()) || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null || host==null || !host.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+") || !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))) throw new IllegalArgumentException("Use a local IP address");
        String[] parts=host.split("\\."); int[] n=new int[4];for(int i=0;i<4;i++){ n[i]=Integer.parseInt(parts[i]);if(n[i]>255)throw new IllegalArgumentException("Invalid IP"); }
        if(!(n[0]==10 || n[0]==127 || n[0]==192&&n[1]==168 || n[0]==172&&n[1]>=16&&n[1]<=31 || n[0]==100&&n[1]>=64&&n[1]<=127 || n[0]==169&&n[1]==254)) throw new IllegalArgumentException("Use a local IP address");
        return "http://"+host+":"+(uri.getPort()<0?80:uri.getPort());
    }

    @PluginMethod
    public void postSync(PluginCall call) {
        network.execute(() -> {
            java.net.HttpURLConnection connection=null;
            try {
                String route=call.getString("path");
                if(!"/pair".equals(route)&&!"/sync".equals(route))throw new IllegalArgumentException("Invalid sync route");
                JSObject body=call.getObject("body");
                if(body==null || body.length()!=3 || !body.has("clientId") || !body.has("iv") || !body.has("data"))throw new IllegalArgumentException("Encrypted sync envelope required");
                byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);
                if(bytes.length>70*1024*1024)throw new IllegalArgumentException("Message too large");
                connection=(java.net.HttpURLConnection)new java.net.URL(endpoint(call.getString("endpoint"))+route).openConnection();
                connection.setConnectTimeout(6000);connection.setReadTimeout(12000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setFixedLengthStreamingMode(bytes.length);
                try(OutputStream output=connection.getOutputStream()){output.write(bytes);}
                if(connection.getResponseCode()!=200)throw new IllegalStateException(connection.getResponseCode()==401?"Pairing expired; pair again":"Sync center returned "+connection.getResponseCode());
                String content=text(connection.getInputStream());
                call.resolve(new JSObject().put("body",new JSONObject(content)));
            }catch(Exception error){call.reject("Unable to reach sync center: "+error.getMessage(),error);}
            finally{if(connection!=null)connection.disconnect();}
        });
    }

    @PluginMethod
    @SuppressWarnings("deprecation")
    public void discoverSync(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if(discovering){call.reject("Discovery already running");return;}discovering=true;
            android.net.nsd.NsdManager manager=(android.net.nsd.NsdManager)getContext().getSystemService(android.content.Context.NSD_SERVICE);
            java.util.Map<String,JSONObject> found=new java.util.concurrent.ConcurrentHashMap<>();
            java.util.ArrayDeque<android.net.nsd.NsdServiceInfo> queue=new java.util.ArrayDeque<>();
            boolean[] resolving={false},finished={false};
            android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
            Runnable[] next=new Runnable[1];
            next[0]=()->{
                if(finished[0]||resolving[0]||queue.isEmpty())return;
                resolving[0]=true;
                manager.resolveService(queue.remove(),new android.net.nsd.NsdManager.ResolveListener(){
                    public void onResolveFailed(android.net.nsd.NsdServiceInfo service,int code){handler.post(()->{resolving[0]=false;next[0].run();});}
                    public void onServiceResolved(android.net.nsd.NsdServiceInfo service){
                        try{
                            String address=endpoint("http://"+service.getHost().getHostAddress()+":"+service.getPort());
                            byte[] id=service.getAttributes().get("id");
                            if(id!=null)found.put(address,new JSONObject().put("name",service.getServiceName()).put("endpoint",address).put("hubId",new String(id,StandardCharsets.UTF_8)));
                        }catch(Exception ignored){}
                        handler.post(()->{resolving[0]=false;next[0].run();});
                    }
                });
            };
            android.net.nsd.NsdManager.DiscoveryListener listener=new android.net.nsd.NsdManager.DiscoveryListener(){
                public void onDiscoveryStarted(String type){}
                public void onServiceFound(android.net.nsd.NsdServiceInfo info){handler.post(()->{queue.add(info);next[0].run();});}
                public void onServiceLost(android.net.nsd.NsdServiceInfo info){}
                public void onDiscoveryStopped(String type){}
                public void onStartDiscoveryFailed(String type,int code){}
                public void onStopDiscoveryFailed(String type,int code){}
            };
            try{manager.discoverServices("_dayweave._tcp.",android.net.nsd.NsdManager.PROTOCOL_DNS_SD,listener);}
            catch(Exception error){discovering=false;call.reject("Local discovery unavailable",error);return;}
            handler.postDelayed(()->{
                finished[0]=true;discovering=false;
                try{manager.stopServiceDiscovery(listener);}catch(Exception ignored){}
                call.resolve(new JSObject().put("peers",new org.json.JSONArray(found.values())));
            },4000);
        });
    }

    @Override
    protected void handleOnDestroy(){network.shutdownNow();super.handleOnDestroy();}

    private File file(String name) {
        if (name == null || !name.matches("^(sync\\.json|data\\.json|data\\.backup\\.json|data\\.corrupt-[0-9]+\\.json|data\\.(json|backup\\.json)\\.before-restore-[0-9]+)$")) {
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
            getBridge().getWebView().setBackgroundColor(Color.parseColor(dark ? "#182230" : "#f9fbfe"));
            call.resolve();
        });
    }
}
