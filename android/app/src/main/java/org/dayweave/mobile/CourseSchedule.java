package org.dayweave.mobile;

import java.time.*;
import java.util.*;

/** Pure calendar engine shared by both native widget sizes. No device timezone. */
public final class CourseSchedule {
    public static final class Event {
        public final String name, location, teacher, zone;
        public final long start, end;
        public Event(String name, String location, String teacher, String zone, long start, long end) {
            this.name=name;this.location=location;this.teacher=teacher;this.zone=zone;this.start=start;this.end=end;
        }
    }
    public static final class Course {
        public final String name,location,teacher,start,end;
        public final int weekday;
        public final int[] weeks;
        public final Set<String> excluded;
        public Course(String name,String location,String teacher,int weekday,String start,String end,int[] weeks,Set<String> excluded){
            this.name=name;this.location=location;this.teacher=teacher;this.weekday=weekday;this.start=start;this.end=end;this.weeks=weeks;this.excluded=excluded;
        }
    }
    public static List<Event> expand(String firstMonday,String zone,List<Course> courses,List<Event> events,Set<String> holidays,long now) {
        List<Event> result=new ArrayList<>();
        for(Event event:events)if(event.end>now)result.add(event);
        LocalDate first=LocalDate.parse(firstMonday);ZoneId timeZone=ZoneId.of(zone);
        for(Course course:courses)for(int week:course.weeks){
            LocalDate day=first.plusDays((week-1L)*7+course.weekday-1);
            if(holidays.contains(day.toString())||course.excluded.contains(day.toString()))continue;
            long start=ZonedDateTime.of(day,LocalTime.parse(course.start),timeZone).toInstant().toEpochMilli();
            long end=ZonedDateTime.of(day,LocalTime.parse(course.end),timeZone).toInstant().toEpochMilli();
            if(end>now)result.add(new Event(course.name,course.location,course.teacher,zone,start,end));
        }
        result.sort(Comparator.comparingLong(e->e.start));return result;
    }
    public static Event current(List<Event> events,long now){for(Event e:events)if(e.start<=now&&e.end>now)return e;return null;}
    public static Event next(List<Event> events,long now){for(Event e:events)if(e.start>now)return e;return null;}
}
