package org.dayweave.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Dedicated school browser. It deliberately does not extend BridgeActivity or add a JS interface. */
public class FudanImportActivity extends AppCompatActivity {
    private static final String LOGIN = "https://fdjwgl.fudan.edu.cn/student/sso/login?targetUrl=/student/for-std/course-table";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView status;
    private Button read;
    private String resultKey;
    private int polls;
    private boolean busy;

    static boolean official(String value) {
        if (value == null) return false;
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
            && ("fdjwgl.fudan.edu.cn".equals(host) || "id.fudan.edu.cn".equals(host) || "uis.fudan.edu.cn".equals(host));
    }
    static boolean courseTable(String value) {
        if (!official(value)) return false;
        Uri uri = Uri.parse(value);
        String path = uri.getPath();
        return "fdjwgl.fudan.edu.cn".equals(uri.getHost()) && path != null
            && (path.equals("/student/for-std/course-table") || path.startsWith("/student/for-std/course-table/"));
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(Activity.RESULT_CANCELED);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(24, 24, 24));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            var bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setPadding(dp(8), dp(6), dp(8), dp(6));
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        Button close = new Button(this);
        close.setText("关闭");
        close.setTextColor(Color.WHITE);
        close.setOnClickListener(view -> finish());
        toolbar.addView(close, new LinearLayout.LayoutParams(dp(72), dp(48)));
        status = new TextView(this);
        status.setTextColor(Color.rgb(244, 244, 245));
        status.setTextSize(12);
        status.setPadding(dp(8), 0, dp(8), 0);
        status.setText("请自行登录并选择学期；登录信息不会传回时织。");
        toolbar.addView(status, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        read = new Button(this);
        read.setText("读取课表");
        read.setTextColor(Color.rgb(118, 185, 237));
        read.setOnClickListener(view -> capture());
        toolbar.addView(read, new LinearLayout.LayoutParams(dp(108), dp(48)));
        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSaveFormData(false);
        settings.setSavePassword(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setDownloadListener((url, userAgent, disposition, mime, size) -> status.setText("此导入窗口不下载文件，请返回课程表后读取。"));
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, android.os.Message result) { return false; }
            @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams parameters) { return false; }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return block(request.getUrl().toString()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return block(url); }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler errorHandler, SslError error) {
                errorHandler.cancel(); status.setText("学校页面证书无法验证，请关闭后重试。");
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (busy) cancelCapture("页面已切换，请打开课程表后重新读取。");
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { finish(); }
        });
        web.loadUrl(LOGIN);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private boolean block(String url) {
        if (official(url)) return false;
        status.setText("只允许打开复旦教务与统一身份认证页面。");
        return true;
    }
    private void cancelCapture(String message) {
        handler.removeCallbacksAndMessages(null);
        if (web != null && resultKey != null) web.evaluateJavascript("delete window[" + JSONObject.quote(resultKey) + "]", null);
        resultKey = null; busy = false;
        read.setEnabled(true);
        if (message != null) status.setText(message);
    }
    private void capture() {
        if (busy) return;
        if (!courseTable(web.getUrl())) { status.setText("请先登录并打开课程表，选择学期后重试。"); return; }
        try {
            String source;
            try (InputStream input = getAssets().open("fudan-capture.js"); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] bytes = new byte[4096]; int length;
                while ((length = input.read(bytes)) != -1) output.write(bytes, 0, length);
                source = output.toString(StandardCharsets.UTF_8.name());
            }
            busy = true; read.setEnabled(false); polls = 0;
            status.setText("正在读取所选学期的课表…");
            resultKey = "__dayweaveFudan_" + UUID.randomUUID().toString().replace("-", "");
            String key = JSONObject.quote(resultKey);
            web.evaluateJavascript("(()=>{window[" + key + "]={done:false};Promise.resolve(" + source + ").then(content=>{window[" + key + "]={done:true,content};}).catch(()=>{window[" + key + "]={done:true,error:true};});})()", null);
            handler.postDelayed(() -> poll(resultKey), 200);
        } catch (Exception error) { cancelCapture("无法加载课表读取程序，请更新时织后重试。"); }
    }
    private void poll(String key) {
        if (!busy || key == null || !key.equals(resultKey) || isFinishing()) return;
        if (++polls > 100 || !courseTable(web.getUrl())) { cancelCapture("读取超时或页面已切换，请返回课程表重试。"); return; }
        web.evaluateJavascript("JSON.stringify(window[" + JSONObject.quote(key) + "] || null)", result -> {
            if (!busy || !key.equals(resultKey) || isFinishing()) return;
            try {
                Object decoded = new JSONTokener(result).nextValue();
                JSONObject value = decoded instanceof String ? new JSONObject((String)decoded) : null;
                if (value != null && value.optBoolean("done")) {
                    String content = value.optString("content", "");
                    if (value.optBoolean("error") || content.isEmpty() || content.length() > 262144) {
                        cancelCapture("读取失败，请确认已登录并选好学期，或使用文件导入。"); return;
                    }
                    cancelCapture(null);
                    setResult(Activity.RESULT_OK, new Intent().putExtra("content", content));
                    finish(); return;
                }
                handler.postDelayed(() -> poll(key), 200);
            } catch (Exception error) { cancelCapture("读取课表失败，请重新选择学期后再试。"); }
        });
    }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            if (resultKey != null) web.evaluateJavascript("delete window[" + JSONObject.quote(resultKey) + "]", null);
            web.stopLoading();
            ((ViewGroup)web.getParent()).removeView(web);
            web.destroy(); web = null;
        }
        super.onDestroy();
    }
}
