# Goal

Ship 时织 / Dayweave: unified Clearlist tasks, Open Timelog records/goals, timezone-aware courses, Xiaomi/Android widgets and AI API for Windows, Android and macOS.

# Current State

- Derived from clean Clearlist v0.2.0 history and complete MIT Open Timelog v0.2.0 module. Independent IDs org.dayweave.desktop/mobile and profile Dayweave preserve the original apps.
- Unified version-1 JSON state adds timelog, schedule and an explicit schedule timezone (default Asia/Shanghai). Instants remain UTC epoch; calendar rules use the selected zone, never host timezone.
- Repository: https://github.com/AlexbeatsZ/dayweave, own main.
- Source/APK version 0.4.0 (Android versionCode 7): one responsive page tree for phone and PC, with tasks/records/arrangements/statistics. PC has a permanent sidebar with context categories/settings, no collapse; phone has a bottom bar/drawer. Resizing across 700 px preserves navigation, timer and task drafts. Natural-week plans, due-null inbox, shared create/edit task draft, optional effort minutes, list/activity mappings, four color categories, long-press ordering with visible ordinals and animated tabs. Completed items stay gray at the bottom only in daily/weekly plans. See mobile-interface.md and architecture.md before changing interactions.
- Records owns timeline/timer/goals. One activity timer supports optional future deadline, editable presets/start/end, plan/tags/note and atomic next activity. Pomodoro UI/routes/helpers removed; legacy fields remain readable. Course grid has two-tap blank creation/shared bottom editor, adjustable morning/afternoon/evening periods and import actions under one shared FAB.
- Fudan website import uses official user-operated SSO in a dedicated Android/Electron window and one minimal capture script; selected semester converts to a normal preview before merge. No credentials enter business data. Real-account import has not been accepted on a device; read docs/design/fudan-import.md before modifying this boundary.
- Public v0.3.0 tag is 59c254ae63c0e32259dfcb7eb121e3c601a7754d; 13 uploaded assets match local names/sizes. Final four-platform CI 39471586657 succeeded. Release has Windows EXE, stable-signed APK, both Mac architectures DMG/ZIP, AI tools/guide, OpenAPI, CSV, licenses and source ZIP.
- ROG hub encrypted LAN sync, mDNS discovery and first-use invitations; offline three-way merges preserve conflicts. Canonical time records are open while endAt=null.
- Phone Redmi K70 and Pad 6 Pro have independent APK installed; installation and updates authorized. Never clear either profile. Device endpoints belong in the private task log.
- Last confirmed physical device version is signed 0.3.0; latest phone update was install-only, no UI operations. Signed 0.4.0 APK is under release/. Wireless ADB discovers no device; phone/tablet updates await current endpoints. Keep all peers and ROG on compatible versions: old strict schemas reject effort, periods, tag colors and timer preferences. Preserve data and pairing during authorized updates.
- ROG runs the packaged desktop 0.4.0 with --tray in current-user DayweaveHub logon task, installed at C:\Users\Meta\AppData\Local\Programs\Dayweave\Dayweave.exe. Hidden startup, close-to-tray and active background API verified (/health storage ready).
- Local OMEN (win) desktop 0.4.0 installed at C:\Users\Meta\AppData\Local\Programs\Dayweave\Dayweave.exe with Desktop/Start Menu shortcuts.
- Mac (arm64) desktop 0.4.0 installed at /Applications/Dayweave.app.
- Real phone-start/tablet-stop synchronization preserved one record ID. Tablet 4x2 widget added through the standard Android picker, reads synced courses and opens the timetable. Phone widget checks paused at user's request; do not operate the phone while they are using it.

# Active Work

- 0.4.0 checks: 85 Node tests and 32 browser workflows pass, including all shared phone flows and four PC flows. Final PC layout rerun passes at 1440x900, 1920x1080, 1280x800 and 900x700; cross-breakpoint draft/timer retention, mouse sorting and reduced motion pass. TypeScript/format/production build, Electron storage/UI-API/tray, isolated Fudan capture and headless API checks pass. Final Windows portable and unpacked API/tray checks pass; Android release/lint and stable APK signature pass (3 Java tests passed earlier this turn, cached in final asset-only rebuild). Artifacts and synthetic previews are under release/. No 0.4.0 published Release or local Mac package yet.
- Finish coordinated ROG/mobile update when approved and reachable; current ROG remains 0.3.0. Prepared narrow upgrade script under ignored .local/upgrade-rog-0.4.0.ps1 preserves profile, keys, task and hidden startup. Do not run old clients with new fields and call it verified sync. Real Fudan login, physical gestures and cross-device new-field acceptance remain pending.
- LAN direct pairing works. Automatic mDNS discovery on the actual LAN remains unconfirmed. Android sync is foreground/resume only; background instantaneous propagation is not implemented.
- Preserve keys only under ignored .local. Keep original repos/profiles untouched.

# Build / Run / Test

- npm ci; npm test; npm run build; npm run test:e2e; npm run test:api.
- npm run dist:win; npm run dist:android; npm run dist:mac (macOS).
- Tests use DAYWEAVE_DATA_DIR under a dedicated temporary directory. Never use a live profile.

# Architecture Principles

- Keep the final architecture simple and clean. Merge new behavior into the existing domain and persistence path; remove obsolete implementations when replacing them.
- One owner for each state: the unified store owns saved data, the shared responsive shell owns navigation, and the timeline owns its scroll window. Derive views and statistics instead of mirroring state through subscriptions or effects. Breakpoint changes adjust layout without remounting the application.
- Reuse one implementation for the same behavior across tasks/records and phone/desktop: modal focus/back, tab/swipe switching, add buttons, clocks, time ranges and goal progress. Avoid parallel helper functions with different names for the same rule.
- Extract a module only when it concentrates real behavior used by multiple callers or isolates a complex cohesive concept. Do not add pass-through wrappers, speculative layers, generic frameworks or files solely to reduce line counts.
- Preserve epoch-based timing, selected schedule timezone, historical point rates and existing data compatibility. Refactors must keep UI/API/sync writes on the same validated transaction queue.
- Delete dead navigation/CSS/functions in the touched area; keep ownership and necessary design decisions in docs/design/architecture.md. Verify through real user flows, especially scroll dates/points and native back, rather than tests mirroring implementation details.

# Durable Lessons

- Save timestamps/segments, never tick counts. Storage corruption must remain recoverable, never silently become empty state.
- All UI and API writes share StateService; module changes have optimistic conflict checks.
- Zod defaults can survive .partial(): PATCH schemas must explicitly remove defaults for optional configuration fields (e.g. periods), otherwise an unrelated write silently resets saved configuration.
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
- docs/design/fudan-import.md: official login windows, minimal capture, pure conversion, preview and acceptance limits.
