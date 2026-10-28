package org.dayweave.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Arrays;
import java.util.List;

public class UsageSessionsTest {
    @Test public void duplicateResumeAndOtherPackagePauseDoNotTruncateSession() {
        List<UsageSessions.Session> result=UsageSessions.build(Arrays.asList(new UsageSessions.Event(10,1,"editor"),new UsageSessions.Event(12,1,"editor"),new UsageSessions.Event(15,2,"other"),new UsageSessions.Event(20,2,"editor")),30);
        assertEquals(1,result.size());assertEquals(10,result.get(0).start);assertEquals(20,result.get(0).end);
    }
    @Test public void screenOffEndsSessionAndDoesNotFillSleepGap() {
        List<UsageSessions.Session> result=UsageSessions.build(Arrays.asList(new UsageSessions.Event(10,1,"editor"),new UsageSessions.Event(20,15,""),new UsageSessions.Event(1000,1,"browser")),1010);
        assertEquals(2,result.size());assertEquals(20,result.get(0).end);assertEquals(1000,result.get(1).start);
    }
    @Test public void runningSessionRetainsStableStartForRevisionUpdates() {
        List<UsageSessions.Event> events=Arrays.asList(new UsageSessions.Event(10,1,"browser"));
        assertEquals(10,UsageSessions.build(events,20).get(0).start);assertEquals(10,UsageSessions.build(events,40).get(0).start);
    }
    @Test public void browserParserRejectsTitlesInputAndCredentials() {
        assertNull(BrowserAddress.parse("Example page title",false));assertNull(BrowserAddress.parse("example.com",true));assertNull(BrowserAddress.parse("https://user:password@example.com",false));
        assertEquals("example.com/read",BrowserAddress.parse("https://example.com/read",false));
    }
}
