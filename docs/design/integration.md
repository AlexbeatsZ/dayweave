# Dayweave integration

## Data and migration

One validated JSON file owns tasks/lists/tag colors, timelog and schedule. Legacy Pomodoro fields are read only for old backup compatibility; the feature and API routes are removed. Original Clearlist v1 files are accepted by defaulting new fields. Open Timelog backup merges through its original conflict-aware domain implementation. All imports are explicit; original apps and profiles are not accessed. Module edits use whole-module optimistic compare-and-swap; task fields retain independent field merges.

Task `estimatedMinutes` and `actualMinutes` are independently optional/nullable, finite nonnegative minute values; zero and fractional minutes are valid. Omission preserves legacy data and an unrelated PATCH must retain existing values; explicit `null` clears a value. The common new/edit form never fills actual time from records: saved, non-deleted records linked by `taskId` provide a separate read-only cumulative reference, excluding a running timer. Recurring tasks inherit the estimate but start each occurrence with no actual value. Task deltas and synchronization merge these properties as independent fields.

## Timezone

Default Asia/Shanghai for all schedule days, task dates and time-record grouping. Host system timezone stays unchanged. IANA regions and fixed UTC offsets are supported. Course wall clocks resolve using the course/semester timezone and Temporal; stored occurrences use UTC epoch. Device-local secondary labels are display only. Recurring courses use semester start Monday, teaching weeks, weekday, start/end, exceptions. ICS imports expand bounded recurrence while preserving absolute instants.

`schedule.periods` configures the course-grid ruler: 1–30 ordered `{start, end, section}` entries, with `HH:mm` wall clocks and `morning` / `afternoon` / `evening` sections. An individual section may have zero entries, but the whole day cannot be empty. Ends must follow starts; entries must follow time and section order without overlap (adjacent boundaries are allowed). Missing periods in an old schedule receive an independent copy of the default ruler. This is display/editor configuration: changing it never rewrites a course's own `start`/`end` or changes occurrence epoch instants. It participates in the existing schedule transaction, backup and synchronization path. `PATCH /schedule` accepts explicit periods and must preserve them when only another setting is patched; its partial input must not apply the storage default to an omitted field.

## Widgets

Native RemoteViews, 2x2 and 4x2 variants, :widgetProvider process, miui exposure updates, no WebView dependency. Read committed unified data and calculate next occurrence with java.time. Show current/next class, absolute date, classroom, zone and Chronometer to next boundary. Update on writes, boot, clock/timezone change, exposure, periodic and inexact boundary alarm. Android may delay alarms; no exact-alarm permission is required. App pin request is optional; launcher always allows manual add.

## AI API

Authenticated loopback HTTP at 127.0.0.1:49731/api/v1, token discovery api.json, OpenAPI and CLI. ROG can run the app or standalone headless API against its own profile; remote control uses SSH forwarding rather than public unauthenticated listeners. Unified context includes today tasks, active timers, current/next courses and epoch instants. All writes share the same storage queue as UI; If-Match prevents stale writes.

## Synchronization

ROG owns an optional encrypted LAN listener at 49732; AI loopback and synchronization share StateService. Read sync.md before changing merge or transport logic. Android sync runs while the app is open; system background freezing is explicitly shown in settings.

## Visual direction

Study planner with neutral gray surfaces (#181818 canvas / #252525 cards in dark mode), white/grayscale text and one ice-blue action accent #76b9ed. List/activity/tag colors remain categorical markers; task urgency uses a yellow or red left line. Segoe UI/PingFang body, condensed Bahnschrift numerals. The phone has four global pages: tasks (daily/weekly/all/inbox), records (timeline/timer/goals), arrangements (calendar/courses), statistics (daily/tasks/records). Shared tabs animate on click/swipe; task long-press ordering persists through the unified store. See mobile-interface.md for current color/layout and architecture.md for state ownership.
