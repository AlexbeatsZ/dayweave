package org.dayweave.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
import java.time.*;
public class CourseScheduleTest {
    CourseSchedule.Course course(int[] weeks,Set<String> excluded){return new CourseSchedule.Course("Chemistry","H4306","",1,"08:00","09:40",weeks,excluded);}
    @Test public void shanghaiCourseIgnoresDeviceTimezone(){
        TimeZone original=TimeZone.getDefault();
        try{for(String device:new String[]{"GMT-04:00","America/New_York","UTC","Asia/Shanghai"}){
            TimeZone.setDefault(TimeZone.getTimeZone(device));
            List<CourseSchedule.Event> events=CourseSchedule.expand("2026-09-07","Asia/Shanghai",Arrays.asList(course(new int[]{1,3},Collections.emptySet())),Collections.emptyList(),Collections.emptySet(),0);
            assertEquals(2,events.size());assertEquals(Instant.parse("2026-09-07T00:00:00Z").toEpochMilli(),events.get(0).start);
            assertEquals(Instant.parse("2026-09-21T00:00:00Z").toEpochMilli(),events.get(1).start);
        }}finally{TimeZone.setDefault(original);}
    }
    @Test public void holidaysAndExcludedDatesDoNotAppear(){
        List<CourseSchedule.Event> events=CourseSchedule.expand("2026-09-07","Asia/Shanghai",Arrays.asList(course(new int[]{1,2,3},new HashSet<>(Arrays.asList("2026-09-14")))) ,Collections.emptyList(),new HashSet<>(Arrays.asList("2026-09-07")),0);
        assertEquals(1,events.size());assertEquals(Instant.parse("2026-09-21T00:00:00Z").toEpochMilli(),events.get(0).start);
    }
    @Test public void currentEndsExactlyAtBoundary(){
        CourseSchedule.Event event=new CourseSchedule.Event("A","","","Asia/Shanghai",100,200);
        assertNotNull(CourseSchedule.current(Arrays.asList(event),100));assertNull(CourseSchedule.current(Arrays.asList(event),200));assertNotNull(CourseSchedule.next(Arrays.asList(event),99));
    }
}
