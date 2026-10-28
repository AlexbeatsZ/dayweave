package org.dayweave.mobile;

import java.util.ArrayList;
import java.util.List;

final class UsageSessions {
    static final class Event {
        final long at; final int type; final String app;
        Event(long at,int type,String app){this.at=at;this.type=type;this.app=app;}
    }
    static final class Session {
        final long start,end; final String app;
        Session(long start,long end,String app){this.start=start;this.end=end;this.app=app;}
    }
    static List<Session> build(List<Event> events,long end) {
        List<Session> result=new ArrayList<>();String active=null;long start=0;
        for(Event event:events) {
            if(event.at>end)break;
            if(event.type==1) {
                if(active!=null&&active.equals(event.app))continue;
                if(active!=null&&event.at>start)result.add(new Session(start,event.at,active));
                active=event.app;start=event.at;
            } else if(event.type==15||event.type==17||event.type==26||event.type==2&&event.app!=null&&event.app.equals(active)) {
                if(active!=null&&event.at>start)result.add(new Session(start,event.at,active));active=null;
            }
        }
        if(active!=null&&end>start)result.add(new Session(start,end,active));
        return result;
    }
}
