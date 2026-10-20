# Dayweave integration

## Data and migration

One validated JSON file owns tasks/lists/focus, timelog and schedule. Original Clearlist v1 files are accepted by defaulting new fields. Open Timelog backup merges through its original conflict-aware domain implementation. All imports are explicit; original apps and profiles are not accessed. Module edits use whole-module optimistic compare-and-swap; task fields retain independent field merges.

## Timezone

Default Asia/Shanghai for all schedule days, task dates and time-record grouping. Host system timezone stays unchanged. IANA regions and fixed UTC offsets are supported. Course wall clocks resolve using the course/semester timezone and Temporal; stored occurrences use UTC epoch. Device-local secondary labels are display only. Recurring courses use semester start Monday, teaching weeks, weekday, start/end, exceptions. ICS imports expand bounded recurrence while preserving absolute instants.

## Widgets

Native RemoteViews, 2x2 and 4x2 variants, :widgetProvider process, miui exposure updates, no WebView dependency. Read committed unified data and calculate next occurrence with java.time. Show current/next class, absolute date, classroom, zone and Chronometer to next boundary. Update on writes, boot, clock/timezone change, exposure, periodic and inexact boundary alarm. Android may delay alarms; no exact-alarm permission is required. App pin request is optional; launcher always allows manual add.

## AI API

Authenticated loopback HTTP at 127.0.0.1:49731/api/v1, token discovery api.json, OpenAPI and CLI. ROG can run the app or standalone headless API against its own profile; remote control uses SSH forwarding rather than public unauthenticated listeners. Unified context includes today tasks, active timers, current/next courses and epoch instants. All writes share the same storage queue as UI; If-Match prevents stale writes.

## Synchronization

ROG owns an optional encrypted LAN listener at 49732; AI loopback and synchronization share StateService. Read sync.md before changing merge or transport logic. Android sync runs while the app is open; system background freezing is explicitly shown in settings.

## Visual direction

Study planner with slate ink #25364b, blue #4264b2, pale blue #eef3fb, white #ffffff and amber #b57827. Segoe UI/PingFang body, condensed Bahnschrift numerals. Weekly course grid plus a narrow dual-timezone next-class rail is the characteristic element. Keep task navigation and timelog sub-tabs concise; no duplicated app chrome.
