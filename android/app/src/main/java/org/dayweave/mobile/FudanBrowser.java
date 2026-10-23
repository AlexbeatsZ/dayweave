package org.dayweave.mobile;

import android.content.Context;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Restricted school browser. No Capacitor bridge or JavascriptInterface is exposed. */
final class FudanBrowser {
    static final String TABLE = "https://fdjwgl.fudan.edu.cn/student/for-std/course-table";
    static final String LOGIN = "https://fdjwgl.fudan.edu.cn/student/sso/login?targetUrl=/student/for-std/course-table";
    static final String CANCELED = "课表更新已取消，已有课表已保留。 [FUDAN_CANCELED]";
    interface Result { void finish(String content, String error); }
    final WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Consumer<String> status;
    private final Pending pending = new Pending();
    private String semester, captureUrl;
    private boolean capturing;

    // Ownership transitions are independent of Android and covered by local JVM tests.
    static final class Pending {
        private Result callback;
        private String key;
        private boolean destroyed;
        String begin(Result result) {
            if (destroyed || key != null) return null;
            callback = result;
            key = "__dayweaveFudan_" + UUID.randomUUID().toString().replace("-", "");
            return key;
        }
        boolean current(String active) { return !destroyed && active != null && active.equals(key); }
        Result take(String active) {
            if (!current(active)) return null;
            Result result = callback;
            callback = null; key = null;
            return result;
        }
        void close() { destroyed = true; key = null; callback = null; }
    }

    /** One owner for refresh/login admission, including late callback rejection. */
    static final class Sessions<T> {
        private T refresh;
        private boolean importing, closed, foreground = true;
        boolean beginImport() {
            if (closed || !foreground || importing) return false;
            importing = true; return true;
        }
        void endImport() { importing = false; }
        boolean beginRefresh(T owner) {
            if (closed || !foreground || importing || refresh != null) return false;
            refresh = owner; return true;
        }
        T takeRefresh(T owner) { return refresh == owner ? takeRefresh() : null; }
        T takeRefresh() { T value = refresh; refresh = null; return value; }
        T pause() { foreground = false; return takeRefresh(); }
        void resume() { if (!closed) foreground = true; }
        T close() { closed = true; importing = false; return takeRefresh(); }
    }

    static String desktopUserAgent(String current) {
        // Retain the installed Chromium version instead of advertising a different engine.
        return current.replaceFirst("[(][^)]*(?:Android|Linux)[^)]*[)]", "(Windows NT 10.0; Win64; x64)")
            .replace(" Version/4.0", "").replace(" Mobile ", " ").replaceAll(" Mobile$", "");
    }
    static boolean official(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getRawUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && ("fdjwgl.fudan.edu.cn".equalsIgnoreCase(host) || "id.fudan.edu.cn".equalsIgnoreCase(host) || "uis.fudan.edu.cn".equalsIgnoreCase(host));
        } catch (Exception error) { return false; }
    }
    static boolean courseTable(String value) {
        if (!official(value)) return false;
        try {
            URI uri = new URI(value).normalize();
            String path = uri.getRawPath();
            return "fdjwgl.fudan.edu.cn".equalsIgnoreCase(uri.getHost()) && path != null
                && !path.toLowerCase(java.util.Locale.ROOT).contains("%2e")
                && (path.equals("/student/for-std/course-table") || path.startsWith("/student/for-std/course-table/"));
        } catch (Exception error) { return false; }
    }
    static String captureError(String remote) {
        // A remote page can overwrite the result holder; reconstruct only known error codes.
        java.util.regex.Matcher match = java.util.regex.Pattern.compile(java.util.regex.Pattern.quote("[FUDAN_") + "([A-Z_]+?)(?:_([45][0-9]{2}))?" + java.util.regex.Pattern.quote("]") + "$").matcher(remote == null ? "" : remote);
        String code = match.find() ? match.group(1) : "SCRIPT";
        String message = switch (code) {
            case "PAGE" -> "请先登录并打开复旦教务系统的课程表页面。";
            case "SEMESTER" -> "未找到选中的学期，请在课程表页面选择学期后重试。";
            case "SEMESTER_DATA" -> "未读到当前学期的日期信息，请重新选择学期后重试。";
            case "SESSION" -> "课表登录状态已失效，请重新登录后读取。";
            case "REQUEST" -> "学校课表接口返回错误，请稍后重试。";
            case "NETWORK" -> "课表数据请求失败，请检查网络后重试。";
            case "TIMEOUT" -> "课表数据请求超时，请稍后重试。";
            case "FORMAT" -> "学校返回的课表数据格式无法识别。";
            case "EMPTY" -> "所选学期没有可导入的课程。";
            case "SIZE" -> "课表数据过大，请换一个学期或使用文件导入。";
            default -> null;
        };
        if (message == null) return "课表读取程序执行失败。 [FUDAN_SCRIPT]";
        String http = "REQUEST".equals(code) && match.group(2) != null ? "_" + match.group(2) : "";
        return message + " [FUDAN_" + code + http + "]";
    }

    @SuppressWarnings("deprecation")
    FudanBrowser(Context context, Consumer<String> status) {
        this.status = status;
        web = new WebView(context);
        WebSettings settings = web.getSettings();
        // Must precede the very first load, for both visible login and hidden refresh.
        settings.setUserAgentString(desktopUserAgent(settings.getUserAgentString()));
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
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
        web.setDownloadListener((url, agent, disposition, mime, size) -> status.accept("此导入窗口不下载文件，请返回课程表后读取。"));
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message message) { return false; }
            @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams parameters) { callback.onReceiveValue(null); return true; }
        });
        web.setWebViewClient(new WebViewClient() {
            private boolean block(String url, boolean main) {
                if (pending.destroyed) return true;
                if (official(url) && (!main || semester == null || courseTable(url))) return false;
                if (main) {
                    web.stopLoading();
                    finish(pending.key, null, semester != null
                        ? "课表登录状态已失效，请通过网站导入重新登录。 [FUDAN_SESSION]"
                        : "只允许打开复旦教务与统一身份认证页面。 [FUDAN_PAGE]");
                }
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return block(request.getUrl().toString(), request.isForMainFrame()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return block(url, true); }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler ssl, SslError error) {
                ssl.cancel(); finish(pending.key, null, "学校页面证书无法验证，请稍后重试。 [FUDAN_TLS]");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) finish(pending.key, null, "学校页面加载失败，请检查网络后重试。 [FUDAN_NETWORK]");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) finish(pending.key, null, captureError("[FUDAN_REQUEST_" + response.getStatusCode() + "]"));
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (block(url, true)) return;
                if (capturing) finish(pending.key, null, "页面已切换，请返回课程表重新读取。 [FUDAN_PAGE]");
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (semester == null || capturing || pending.key == null || !url.equals(web.getUrl())) return;
                if (courseTable(url)) runCapture(pending.key);
            }
        });
    }

    void capture(Result callback) {
        String active = begin(callback, null);
        if (active == null) return;
        if (!courseTable(web.getUrl())) { finish(active, null, "请先登录并打开课程表，选择学期后重试。 [FUDAN_PAGE]"); return; }
        runCapture(active);
    }
    void refresh(String semesterId, Result callback) {
        String active = begin(callback, semesterId);
        if (active == null) return;
        if (semesterId == null || !semesterId.matches("[0-9]{1,12}")) {
            finish(active, null, "未保存有效的学期，请重新导入课表。 [FUDAN_SEMESTER]"); return;
        }
        web.loadUrl(TABLE);
    }
    private String begin(Result callback, String semesterId) {
        String active = pending.begin(callback);
        if (active == null) { callback.finish(null, "课表读取已取消或正在进行，请稍后重试。 [FUDAN_BUSY]"); return null; }
        semester = semesterId;
        // Absolute deadline also handles evaluateJavascript callbacks that never arrive.
        handler.postDelayed(() -> finish(active, null, "课表读取超时，已有课表已保留。 [FUDAN_TIMEOUT]"), semesterId == null ? 20000 : 45000);
        return active;
    }
    private void runCapture(String active) {
        if (!pending.current(active) || capturing) return;
        try {
            String source;
            try (InputStream input = web.getContext().getAssets().open("fudan-capture.js"); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] bytes = new byte[4096]; int length;
                while ((length = input.read(bytes)) != -1) output.write(bytes, 0, length);
                source = output.toString(StandardCharsets.UTF_8.name());
            }
            capturing = true; captureUrl = web.getUrl();
            String quoted = JSONObject.quote(active), argument = semester == null ? "null" : JSONObject.quote(semester);
            web.evaluateJavascript("(()=>{const holder={done:false};window[" + quoted + "]=holder;Promise.resolve((" + source + ")(" + argument + ")).then(value=>{if(window[" + quoted + "]===holder)Object.assign(holder,{done:true},value);}).catch(()=>{if(window[" + quoted + "]===holder)Object.assign(holder,{done:true,error:'课表读取程序执行失败。 [FUDAN_SCRIPT]'});});})()", null);
            handler.postDelayed(() -> poll(active), 200);
        } catch (Exception error) { finish(active, null, "无法加载课表读取程序，请更新时织后重试。 [FUDAN_SCRIPT]"); }
    }
    private void poll(String active) {
        if (!pending.current(active)) return;
        if (!courseTable(web.getUrl()) || !captureUrl.equals(web.getUrl())) { finish(active, null, "页面已切换，请返回课程表重新读取。 [FUDAN_PAGE]"); return; }
        web.evaluateJavascript("JSON.stringify(window[" + JSONObject.quote(active) + "] || null)", encoded -> {
            if (!pending.current(active)) return;
            if (!courseTable(web.getUrl()) || !captureUrl.equals(web.getUrl())) { finish(active, null, "页面已切换，请返回课程表重新读取。 [FUDAN_PAGE]"); return; }
            try {
                Object decoded = new JSONTokener(encoded).nextValue();
                JSONObject value = decoded instanceof String ? new JSONObject((String)decoded) : null;
                if (value != null && value.optBoolean("done")) {
                    if (value.has("error")) { finish(active, null, captureError(value.optString("error"))); return; }
                    Object raw = value.opt("content");
                    if (!(raw instanceof String) || ((String)raw).isEmpty() || ((String)raw).length() > 262144) { finish(active, null, "课表读取结果为空或过大。 [FUDAN_RESULT]"); return; }
                    CookieManager.getInstance().flush();
                    finish(active, (String)raw, null); return;
                }
                handler.postDelayed(() -> poll(active), 200);
            } catch (Exception error) { finish(active, null, "读取课表结果失败，请重试。 [FUDAN_RESULT]"); }
        });
    }
    private void finish(String active, String content, String error) {
        if (pending.destroyed) return;
        if (active == null) { if (error != null) status.accept(error); return; }
        Result callback = pending.take(active);
        if (callback == null) return;
        handler.removeCallbacksAndMessages(null);
        capturing = false; captureUrl = null; semester = null;
        web.evaluateJavascript("delete window[" + JSONObject.quote(active) + "]", null);
        if (error != null) status.accept(error);
        callback.finish(content, error);
    }
    void destroy() {
        if (pending.destroyed) return;
        pending.close();
        handler.removeCallbacksAndMessages(null);
        web.stopLoading();
        if (web.getParent() instanceof ViewGroup parent) parent.removeView(web);
        web.destroy();
    }
}
