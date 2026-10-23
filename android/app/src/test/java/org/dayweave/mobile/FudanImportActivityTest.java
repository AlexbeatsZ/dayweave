package org.dayweave.mobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class FudanImportActivityTest {
    @Test public void requestsDesktopSiteWhilePreservingInstalledEngineVersion() {
        String mobile = "Mozilla/5.0 (Linux; Android 16; Redmi K70 Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36";
        String desktop = FudanBrowser.desktopUserAgent(mobile);
        assertTrue(desktop.contains("(Windows NT 10.0; Win64; x64)"));
        assertTrue(desktop.contains("Chrome/141.0.7390.122"));
        assertTrue(desktop.endsWith("Safari/537.36"));
        assertFalse(desktop.contains("Android"));
        assertFalse(desktop.contains("Mobile"));
        assertFalse(desktop.contains("; wv"));
        assertFalse(desktop.contains("Version/4.0"));
    }

    @Test public void preservesAlreadyDesktopAgent() {
        String desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Safari/537.36";
        assertEquals(desktop, FudanBrowser.desktopUserAgent(desktop));
    }

    @Test public void tabletAgentAlsoRequestsDesktopSite() {
        String tablet = "Mozilla/5.0 (Linux; Android 14; Pad 6 Pro; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.80 Safari/537.36";
        String desktop = FudanBrowser.desktopUserAgent(tablet);
        assertTrue(desktop.contains("Windows NT 10.0; Win64; x64"));
        assertTrue(desktop.contains("Chrome/140.0.7339.80"));
        assertFalse(desktop.contains("Android"));
        assertFalse(desktop.contains("wv"));
    }

    @Test public void navigationAllowsOnlyOfficialHttpsWithoutCredentialsOrForeignPorts() {
        for (String url : new String[]{FudanBrowser.LOGIN, FudanBrowser.TABLE, "https://id.fudan.edu.cn/ac/#/index", "https://uis.fudan.edu.cn/authserver/login", "https://FDJWGL.FUDAN.EDU.CN:443/student/for-std/course-table"})
            assertTrue(url, FudanBrowser.official(url));
        for (String url : new String[]{"http://fdjwgl.fudan.edu.cn", "https://fdjwgl.fudan.edu.cn.evil.test", "https://user:secret@fdjwgl.fudan.edu.cn", "https://fdjwgl.fudan.edu.cn:8443", "https://fdjwgl.fudan.edu.cn%5c@evil.test", "file:///private", "javascript:alert(1)", "intent://fdjwgl.fudan.edu.cn", "not a url"})
            assertFalse(url, FudanBrowser.official(url));
        assertFalse(FudanBrowser.official(null));
    }

    @Test public void captureRequiresCourseTablePathOnAcademicHost() {
        assertTrue(FudanBrowser.courseTable(FudanBrowser.TABLE + "?semester=215#view"));
        assertTrue(FudanBrowser.courseTable(FudanBrowser.TABLE + "/semester/215"));
        for (String url : new String[]{FudanBrowser.LOGIN, "https://id.fudan.edu.cn/student/for-std/course-table", FudanBrowser.TABLE + "-other", FudanBrowser.TABLE + "/../other", FudanBrowser.TABLE + "/%2e%2e/other", FudanBrowser.TABLE + "%2fother"})
            assertFalse(url, FudanBrowser.courseTable(url));
    }

    @Test public void errorsReconstructOnlyKnownStagesAndHttpStatus() {
        assertTrue(FudanBrowser.captureError("private-token [FUDAN_REQUEST_503]").endsWith("[FUDAN_REQUEST_503]"));
        assertTrue(FudanBrowser.captureError("private-token [FUDAN_SEMESTER_DATA]").endsWith("[FUDAN_SEMESTER_DATA]"));
        for (String remote : new String[]{null, "private-student", "private-token [FUDAN_UNKNOWN]", "private-token [FUDAN_REQUEST_999]"}) {
            String error = FudanBrowser.captureError(remote);
            assertTrue(error.endsWith("[FUDAN_SCRIPT]"));
            assertFalse(error.contains("private-"));
        }
        assertFalse(FudanBrowser.captureError("private-token [FUDAN_NETWORK]").contains("private-"));
    }

    @Test public void requestsRejectConcurrentAndStaleCallbacksAndCompleteOnce() {
        FudanBrowser.Pending pending = new FudanBrowser.Pending();
        FudanBrowser.Result first = (content, error) -> {};
        String key = pending.begin(first);
        assertNotNull(key);
        assertNull(pending.begin((content, error) -> fail("Must not replace pending callback")));
        assertTrue(pending.current(key));
        assertNull(pending.take("stale-key"));
        assertSame(first, pending.take(key));
        assertNull(pending.take(key));
        String retry = pending.begin((content, error) -> {});
        assertNotNull(retry);
        assertNotEquals(key, retry);
        assertFalse(pending.current(key));
        assertNull(pending.take(key));
        assertTrue(pending.current(retry));
    }

    @Test public void destroyingBrowserInvalidatesAllFutureResultsAndTimeouts() {
        FudanBrowser.Pending pending = new FudanBrowser.Pending();
        String key = pending.begin((content, error) -> fail("Destroyed browser must not deliver"));
        pending.close(); pending.close();
        assertFalse(pending.current(key));
        assertNull(pending.take(key));
        assertNull(pending.begin((content, error) -> {}));
    }

    @Test public void explicitLoginWinsAndRefreshCannotInterruptIt() {
        FudanBrowser.Sessions<Object> sessions = new FudanBrowser.Sessions<>();
        Object refresh = new Object();
        assertTrue(sessions.beginRefresh(refresh));
        assertFalse(sessions.beginRefresh(new Object()));
        assertTrue(sessions.beginImport());
        assertSame(refresh, sessions.takeRefresh());
        assertFalse(sessions.beginRefresh(new Object()));
        assertFalse(sessions.beginImport());
        sessions.endImport();
        assertTrue(sessions.beginRefresh(new Object()));
        assertNull(sessions.takeRefresh(refresh));
    }

    @Test public void pauseCancellationPreservesLoginAndCloseRejectsQueuedWork() {
        FudanBrowser.Sessions<Object> sessions = new FudanBrowser.Sessions<>();
        Object first = new Object(), second = new Object();
        assertTrue(sessions.beginRefresh(first));
        assertSame(first, sessions.pause());
        assertFalse(sessions.beginRefresh(second));
        sessions.resume();
        assertTrue(sessions.beginRefresh(second));
        assertNull(sessions.takeRefresh(first));
        assertSame(second, sessions.takeRefresh(second));
        assertTrue(sessions.beginImport());
        sessions.pause(); sessions.resume();
        assertFalse(sessions.beginRefresh(new Object()));
        sessions.endImport();
        assertTrue(sessions.beginRefresh(second));
        assertSame(second, sessions.close());
        sessions.resume(); sessions.endImport();
        assertFalse(sessions.beginRefresh(first));
        assertFalse(sessions.beginImport());
    }
}
