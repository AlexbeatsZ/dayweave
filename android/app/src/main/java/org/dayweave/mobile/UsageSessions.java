package org.dayweave.mobile;

import java.util.ArrayList;
import java.util.List;

final class UsageSessions {
    // android.app.usage.UsageEvents.Event types; 15 is SCREEN_INTERACTIVE (screen on), not off.
    static final int RESUMED=1, PAUSED=2, SCREEN_NON_INTERACTIVE=16, KEYGUARD_SHOWN=17, KEYGUARD_HIDDEN=18, DEVICE_SHUTDOWN=26;
    static final long DAY=86400000L, RESCAN_MARGIN=10*60000L;
    /** Unknown open session: rescan the whole retained window once (upgrade from older builds). */
    static final long OPEN_UNKNOWN=-1;
    static long captureStart(long now, boolean previouslyEnabled) {
        return previouslyEnabled ? now : Math.max(0, now - 7L * 86400000);
    }
    static final class Event {
        final long at; final int type; final String app;
        Event(long at,int type,String app){this.at=at;this.type=type;this.app=app;}
    }
    static final class Session {
        final long start,end; final String app;
        Session(long start,long end,String app){this.start=start;this.end=end;this.app=app;}
    }
    /**
     * Rescan only what can still change: a short margin before the previous scan, extended back to
     * the start of the session that was still open then, so its resume event is seen again.
     */
    static long scanStart(long now,long first,long previous,long openSince) {
        long floor=Math.max(first,now-7*DAY);
        if(openSince==OPEN_UNKNOWN)return floor;
        long from=previous-RESCAN_MARGIN;
        if(openSince>0)from=Math.min(from,openSince);
        return Math.max(floor,from);
    }
    static List<Session> build(List<Event> events,long end) {
        List<Session> result=new ArrayList<>();String active=null;long start=0;
        for(Event event:events) {
            if(event.at>end)break;
            if(event.type==RESUMED) {
                if(active!=null&&active.equals(event.app))continue;
                if(active!=null&&event.at>start)result.add(new Session(start,event.at,active));
                active=event.app;start=event.at;
            } else if(event.type==SCREEN_NON_INTERACTIVE||event.type==KEYGUARD_SHOWN||event.type==DEVICE_SHUTDOWN||event.type==PAUSED&&event.app!=null&&event.app.equals(active)) {
                if(active!=null&&event.at>start)result.add(new Session(start,event.at,active));active=null;
            }
        }
        if(active!=null&&end>start)result.add(new Session(start,end,active));
        return result;
    }
}
