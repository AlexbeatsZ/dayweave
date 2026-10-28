package org.dayweave.mobile;

import android.content.Context;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class UsageSync {
    private static final int FLAGS=Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING;
    static JSONObject seal(JSONObject value,String key,String id) throws Exception {
        byte[] iv=new byte[12];new SecureRandom().nextBytes(iv);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(Base64.decode(key,FLAGS),"AES"),new GCMParameterSpec(128,iv));
        cipher.updateAAD(("dayweave:1:/usage:"+id).getBytes(StandardCharsets.UTF_8));
        return new JSONObject().put("clientId",id).put("iv",Base64.encodeToString(iv,FLAGS)).put("data",Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)),FLAGS));
    }
    static JSONObject open(JSONObject value,String key,String id) throws Exception {
        if(!id.equals(value.getString("clientId")))throw new IllegalArgumentException("自动记录回执身份不符");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(Base64.decode(key,FLAGS),"AES"),new GCMParameterSpec(128,Base64.decode(value.getString("iv"),FLAGS)));
        cipher.updateAAD(("dayweave:1:/usage:reply:"+id).getBytes(StandardCharsets.UTF_8));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(value.getString("data"),FLAGS)),StandardCharsets.UTF_8));
    }
    static synchronized void run(Context context) throws Exception {
        File file=new File(context.getFilesDir(),"sync.json");if(!file.exists())return;
        android.util.AtomicFile atomic=new android.util.AtomicFile(file);
        JSONObject config=new JSONObject(new String(atomic.readFully(),StandardCharsets.UTF_8));
        if(!config.optBoolean("enabled")||!config.has("key")||!config.has("endpoint")||!config.has("hubId"))return;
        String endpoint=SyncEndpoint.parse(config.getString("endpoint")),id=config.getString("deviceId"),key=config.getString("key"),hub=config.getString("hubId");
        try(UsageDatabase database=new UsageDatabase(context)) {
            for(int batch=0;batch<20;batch++) {
                JSONObject current=new JSONObject(new String(atomic.readFully(),StandardCharsets.UTF_8));
                if(!current.optBoolean("enabled")||!endpoint.equals(current.optString("endpoint"))||!key.equals(current.optString("key"))||!hub.equals(current.optString("hubId")))return;
                JSONArray pending=database.pending();String requestId=java.util.UUID.randomUUID().toString();
                JSONObject request=new JSONObject().put("requestId",requestId).put("events",pending).put("cursor",Long.parseLong(database.meta("cursor:"+hub,"0"))).put("limit",500);
                HttpURLConnection connection=(HttpURLConnection)new URL(endpoint+"/usage").openConnection();
                JSONObject reply;
                try {
                    connection.setConnectTimeout(6000);connection.setReadTimeout(12000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");
                    byte[] bytes=seal(request,key,id).toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);
                    try(OutputStream output=connection.getOutputStream()){output.write(bytes);}
                    int status=connection.getResponseCode();if(status!=200)throw new IllegalStateException(status==403||status==404?"中心尚未支持自动记录，请更新中心程序":"自动记录中心返回 "+status);
                    try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()) {byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(output.size()+count>8*1024*1024)throw new IllegalStateException("自动记录回执过大");output.write(buffer,0,count);}reply=open(new JSONObject(output.toString("UTF-8")),key,id);}
                } finally {connection.disconnect();}
                if(!requestId.equals(reply.getString("requestId")))throw new IllegalStateException("自动记录回执不匹配");
                long cursor=request.getLong("cursor"),next=reply.getLong("cursor");
                if(next<cursor||reply.getBoolean("more")&&next==cursor)throw new IllegalStateException("自动记录同步游标无进展");
                java.util.Map<String,Long> sent=new java.util.HashMap<>();for(int index=0;index<pending.length();index++){JSONObject item=pending.getJSONObject(index);sent.put(item.getString("id"),item.getLong("revision"));}
                JSONArray accepted=reply.getJSONArray("accepted");for(int index=0;index<accepted.length();index++){JSONObject item=accepted.getJSONObject(index);if(!Long.valueOf(item.getLong("revision")).equals(sent.get(item.getString("id"))))throw new IllegalStateException("自动记录回执包含未发送记录");}
                database.receive(hub,reply);
                if(!reply.getBoolean("more")&&pending.length()<300)break;
            }
        }
    }
}
