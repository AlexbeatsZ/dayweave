# Goal

Ship 时织 / Dayweave: unified Clearlist tasks, Open Timelog records/goals, timezone-aware courses, Xiaomi/Android widgets and AI API for Windows, Android and macOS.

# Current State

- Derived from clean Clearlist v0.2.0 history and complete MIT Open Timelog v0.2.0 module. Independent IDs org.dayweave.desktop/mobile and profile Dayweave preserve the original apps.
- Unified version-1 JSON state adds timelog, schedule and an explicit schedule timezone (default Asia/Shanghai). Instants remain UTC epoch; calendar rules use the selected zone, never host timezone.
- Repository: https://github.com/AlexbeatsZ/dayweave, own main.
- Source/APK version 0.3.3 (Android versionCode 6): compact title + three subtabs in one phone header, no top search/theme controls. Four global tabs (tasks/records/courses/more); records owns timeline/timer/goals with click/swipe. Automatic history loading and visible-day date/points, grouped compact goals and one shared FAB. Neutral gray/white/ice-blue palette retained. See docs/design/mobile-interface.md and architecture.md before changing phone interactions.
- Public v0.3.0 tag is 59c254ae63c0e32259dfcb7eb121e3c601a7754d; 13 uploaded assets match local names/sizes. Final four-platform CI 39471586657 succeeded. Release has Windows EXE, stable-signed APK, both Mac architectures DMG/ZIP, AI tools/guide, OpenAPI, CSV, licenses and source ZIP.
- ROG hub encrypted LAN sync, mDNS discovery and first-use invitations; offline three-way merges preserve conflicts. Canonical time records are open while endAt=null.
- Phone Redmi K70 and Pad 6 Pro have independent APK installed; installation and updates authorized. Never clear either profile. Device endpoints belong in the private task log.
- Last confirmed physical device version is signed 0.3.0; latest phone update was install-only, no UI operations. New signed 0.3.3 APK supersedes 0.3.1/0.3.2 under release/. Wireless ADB currently discovers no device; phone update awaits a current endpoint. Subsequent APK changes must be offered/applied to the phone as requested, preserving data and pairing.
- ROG runs the packaged desktop with --tray in current-user DayweaveHub logon task. Hidden startup, close-to-tray and active background API verified; no reboot/logoff performed.
- Real phone-start/tablet-stop synchronization preserved one record ID. Tablet 4x2 widget added through the standard Android picker, reads synced courses and opens the timetable. Phone widget checks paused at user's request; do not operate the phone while they are using it.

# Active Work

- Phone 0.3.3: 49 domain/storage/API/sync tests and 16 browser workflows pass, including real browser touch swipes, auto history beyond seven days, past-day points, quick jumps and identical FABs. Shared clock/theme, Modal and timeline rendering replace duplicate implementations; Workspace reads unified store directly. TypeScript/format/build and Android release/lint pass (unchanged Java tests cached). New physical phone update/UI acceptance remain pending connection. Preserve source/package/real-device evidence separately.
- LAN direct pairing works. Automatic mDNS discovery on the actual LAN remains unconfirmed. Android sync is foreground/resume only; background instantaneous propagation is not implemented.
- Preserve keys only under ignored .local. Keep original repos/profiles untouched.

# Build / Run / Test

- npm ci; npm test; npm run build; npm run test:e2e; npm run test:api.
- npm run dist:win; npm run dist:android; npm run dist:mac (macOS).
- Tests use DAYWEAVE_DATA_DIR under a dedicated temporary directory. Never use a live profile.

# Architecture Principles

- Keep the final architecture simple and clean. Merge new behavior into the existing domain and persistence path; remove obsolete implementations when replacing them.
- One owner for each state: the unified store owns saved data, the phone shell owns navigation, and the timeline owns its scroll window. Derive views and statistics instead of mirroring state through subscriptions or effects.
- Reuse one implementation for the same behavior across tasks/records and phone/desktop: modal focus/back, tab/swipe switching, add buttons, clocks, time ranges and goal progress. Avoid parallel helper functions with different names for the same rule.
- Extract a module only when it concentrates real behavior used by multiple callers or isolates a complex cohesive concept. Do not add pass-through wrappers, speculative layers, generic frameworks or files solely to reduce line counts.
- Preserve epoch-based timing, selected schedule timezone, historical point rates and existing data compatibility. Refactors must keep UI/API/sync writes on the same validated transaction queue.
- Delete dead navigation/CSS/functions in the touched area; keep ownership and necessary design decisions in docs/design/architecture.md. Verify through real user flows, especially scroll dates/points and native back, rather than tests mirroring implementation details.

# Durable Lessons

- Save timestamps/segments, never tick counts. Storage corruption must remain recoverable, never silently become empty state.
- All UI and API writes share StateService; module changes have optimistic conflict checks.
- Xiaomi widgets have a separate :widgetProvider process and must read persisted app-private data without launching the WebView.
- For sideloaded builds, omit Xiaomi-market miuiWidget/miuiWidgetVersion markers: the standard Android picker then exposes both variants on the tested Pad 6 Pro. A successful requestPinAppWidget result does not prove Xiaomi showed a confirmation; keep manual picker instructions.

# Docs Index

- docs/design/integration.md: unified state, migration, timezone, widget and API contracts.
- docs/design/storage.md: inherited durable task storage.
- docs/design/timelog-domain.md: time segments and goals.
- docs/design/platforms.md: mobile/desktop platforms.
- docs/design/mobile-interface.md: phone layouts, navigation, sheets, native back, timeline/analytics and narrow-screen checks.
- docs/design/architecture.md: module ownership, shared UI behavior and consolidation rules.
- docs/design/timelog-interface.md: records, timers, goals and analysis UI.
- docs/design/sync.md: ROG hub, discovery, encryption, conflict/sequence rules and mobile foreground boundary.
