# Goal

Ship 时织 / Dayweave: unified Clearlist tasks, Open Timelog records/goals, timezone-aware courses, Xiaomi/Android widgets and AI API for Windows, Android and macOS.

# Current State

- Derived from clean Clearlist v0.2.0 history and complete MIT Open Timelog v0.2.0 module. Independent IDs org.dayweave.desktop/mobile and profile Dayweave preserve the original apps.
- Unified version-1 JSON state adds timelog, schedule and an explicit schedule timezone (default Asia/Shanghai). Instants remain UTC epoch; calendar rules use the selected zone, never host timezone.
- Repository: https://github.com/AlexbeatsZ/dayweave, own main.
- Source version 0.4.2 (Android versionCode 9): one responsive page tree for phone and PC, with tasks/records/arrangements/statistics. PC has a permanent sidebar with context categories/settings, no collapse; phone has a bottom bar/drawer. Resizing across 700 px preserves navigation, timer and task drafts. Natural-week plans, due-null inbox, shared create/edit task draft, optional effort minutes, list/activity mappings, four color categories, long-press ordering with visible ordinals and animated tabs. Completed items stay gray at the bottom only in daily/weekly plans. See mobile-interface.md and architecture.md before changing interactions.
- Unreleased task UI fix: parent tasks, inline subtasks and editor drafts share TaskCheck. Ordinary task views show checkable children; list changes persist through the unified store, editor changes remain draft-only until Save. Phone sidebar opens with the menu button; no swipe-to-open gesture. Source checks/browser coverage pass; installed 0.4.2 packages do not yet contain this fix.
- Records owns timeline/timer/goals. One activity timer supports optional future deadline, editable presets/start/end, plan/tags/note and atomic next activity. Pomodoro UI/routes/helpers removed; legacy fields remain readable. Course grid has two-tap blank creation/shared bottom editor, adjustable morning/afternoon/evening periods and import actions under one shared FAB.
- Timer idle page shows a create tile at the end of each nature group, including empty groups. Touch hold opens the existing Editor at 450 ms, before release; release cannot dismiss it or start timing. Mouse has visible pencil actions plus right-click/F2. Controls only appear after selecting an activity. Running UI uses a clock card, metadata card and one action row; TimerPanel.css owns all widths. Timetable fits all columns without horizontal scroll; displayDays auto/5/7 defaults to auto and checks actual weekend teaching across the semester, including events. Read the module docs before changing these behaviors.
- Android Fudan subscriptions refresh on startup/resume and every 15 foreground minutes using the chosen semester and existing school session. Only owned school rows are replaced; manual arrangements remain. Failed persistence retains the old/new ownership union, and explicit imports invalidate/hold automatic refresh. See fudan-import.md; true-account acceptance remains pending.
- Fudan website import uses official user-operated SSO in a dedicated Android/Electron window and one minimal capture script; selected semester converts to a normal preview before merge. No credentials enter business data. Real-account import has not been accepted on a device; read docs/design/fudan-import.md before modifying this boundary.
- 0.4.2 Fudan fix is grounded in the user's logged-in Chrome page: select#allSemesters (legacy #semester fallback), activities[].teachers and the explicit Sunday semester anchor. Official API returned 22 teaching rows / 9 course names; minimal replay reproduces the old error and passes the shared capture/parser after the fix. Installed-app import acceptance remains separate. Windows/Android 0.4.2 packages are separate from deployed 0.4.1; no installation is implied.
- Public v0.3.0 tag is 59c254ae63c0e32259dfcb7eb121e3c601a7754d; 13 uploaded assets match local names/sizes. Final four-platform CI 39471586657 succeeded. Release has Windows EXE, stable-signed APK, both Mac architectures DMG/ZIP, AI tools/guide, OpenAPI, CSV, licenses and source ZIP.
- ROG hub encrypted LAN sync, mDNS discovery and first-use invitations; offline three-way merges preserve conflicts. Canonical time records are open while endAt=null.
- Version 0.4.2 deployed and verified per user request across all devices:
  - Local OMEN (win) updated at C:\Users\Meta\AppData\Local\Programs\Dayweave\Dayweave.exe (0.4.2.0), running in tray, connected to ROG hub.
  - ROG updated at C:\Users\Meta\AppData\Local\Programs\Dayweave\Dayweave.exe, DayweaveHub tray task running, API ready, managing 5 peers.
  - Mac (arm64) built and updated at /Applications/Dayweave.app (0.4.2), running in tray, connected to ROG hub.
  - Pad 6 Pro updated via ADB to versionCode 9 (0.4.2), preserving existing profile and 4x2/2x2 widgets.
  - Phone (Redmi K70) updated via ADB to versionCode 9 (0.4.2), preserving profile, no UI operations performed.
- Local OMEN (win) and Mac (arm64) are paired to ROG hub and fully synchronized (1176 tasks, 991 timelog records, /sync/status connected: true).
- Desktop installation paths remain Windows Local Programs/Dayweave and Mac /Applications/Dayweave.app; ROG uses the existing DayweaveHub tray task.
- Real phone-start/tablet-stop synchronization preserved one record ID. Tablet 4x2 widget added through the standard Android picker, reads synced courses and opens the timetable.
- All 0.4.2 release packages generated: Windows NSIS/portable, Android signed APK, and macOS arm64 DMG/ZIP.
- Validation: 102 Node tests, all 56 browser workflows (10 Fudan refresh cases), 13 Android JVM checks, isolated Electron Fudan capture, desktop persistence/recovery and UI/API smoke pass. Web/Electron production builds pass with the existing chunk-size warning. No true-account or physical-device acceptance was performed.

# Active Work

- 2026-10-26 sync review: shared change-triggered scheduler (100ms batching, 2s polling fallback), coalesced now requests, one outgoing snapshot, Android failed-save upload guard, and authenticated-processing errors no longer mislabeled as pairing failure. Import success now waits for persistence. Source-only; installed packages unchanged.
- Review follow-ups: whole-module optimistic conflicts can stall the renderer save queue; retry/reload/restore lack UI recovery routes, and StateService caches a failed initial load. These remain unfixed; do not discard queued edits to hide conflicts. Android still has no native background sync. Read-only live check: ROG ports 49731/49732 listening; local OMEN app/API not running/reachable at check time, superseding historical running-state claims above.

- Real installed-app Fudan capture, physical gestures and new-field cross-device acceptance remain pending. Chrome DOM/API and minimal conversion replay are verified separately; current pairing state belongs to the deployment/sync log and is not changed by this capture fix.
- LAN direct pairing works. Automatic mDNS discovery on the actual LAN remains unconfirmed. Android sync is foreground/resume only; background instantaneous propagation is not implemented.
- Preserve keys only under ignored .local. Keep original repos/profiles untouched.

# Build / Run / Test

- npm ci; npm test; npm run build; npm run test:e2e; npm run test:api.
- npm run dist:win; npm run dist:android; npm run dist:mac (macOS). Packaging does not authorize installation/publication.
- Fudan changes: npm run test:e2e -- tests/e2e/fudan-refresh.spec.ts; npm run build; node scripts/smoke-fudan.mjs; Android testDebugUnitTest.
- Tests use DAYWEAVE_DATA_DIR under a dedicated temporary directory. Never use a live profile.

# Architecture Principles

- Keep the final architecture simple and clean. Merge new behavior into the existing domain and persistence path; remove obsolete implementations when replacing them.
- One owner for each state: the unified store owns saved data, the shared responsive shell owns navigation, and the timeline owns its scroll window. Derive views and statistics instead of mirroring state through subscriptions or effects. Breakpoint changes adjust layout without remounting the application.
- Reuse one implementation for the same behavior across tasks/records and phone/desktop: modal focus/back, tab/swipe switching, add buttons, clocks, time ranges and goal progress. Avoid parallel helper functions with different names for the same rule.
- Extract a module only when it concentrates real behavior used by multiple callers or isolates a complex cohesive concept. Do not add pass-through wrappers, speculative layers, generic frameworks or files solely to reduce line counts.
- Preserve epoch-based timing, selected schedule timezone, historical point rates and existing data compatibility. Refactors must keep UI/API/sync writes on the same validated transaction queue.
- Delete dead navigation/CSS/functions in the touched area; keep ownership and necessary design decisions in docs/design/architecture.md. Verify through real user flows, especially scroll dates/points and native back, rather than tests mirroring implementation details.

# Durable Lessons

- School refresh ownership is a recovery journal, not just the IDs in the optimistic view: retain old/new IDs until the business save queue is healthy, even for no-op refreshes. Pause refresh throughout explicit import preview/confirmation.
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
