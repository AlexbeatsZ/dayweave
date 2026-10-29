# Goal

Ship 时织 / Dayweave: unified Clearlist tasks, Open Timelog records/goals, timezone-aware courses, Xiaomi/Android widgets and AI API for Windows, Android and macOS.

# Current State

- 2026-10-29 authorized 0.4.9/code16 installed on all five devices, phone first: Redmi K70 and Pad upgraded with stable signing and unchanged UIDs10812/10414/firstInstallTime; Pad widget253/provider/host retained. OMEN/ROG/Mac arm64 are running in tray and connected, each1188 tasks/1006 records; OMEN2 conflicts and all sync identities preserved. Local143 Node/86 browser/22 Android/36 Rust and packaging/smoke pass. Four-platform CI40840047136 succeeded for source5cb3312. Release v0.4.9 is published with14 assets; no phone UI actions or new system permissions. Recovery copies retained under each host's temporary .agents/dayweave-upgrade-0.4.9*; evidence .local/deploy-0.4.9/.

- 2026-10-29 live sync configuration: OMEN, Mac, Pad 6 Pro and Redmi K70 now share exactly [http://100.106.169.46:49732, https://cdn.u3146344.nyat.app:63573/dayweave], Tailscale first and public HTTPS second on every request; no LAN entry. ROG remains the existing hub. OMEN/Mac/phone are connected through Tailscale; Pad successfully fell back to public HTTPS. Phone was actually unpaired before this configuration, then joined ROG through a fresh invitation without clearing data; afterward the three desktops converged to1188 tasks/1006 records. Preserve OMEN2, Pad1 and phone11 conflict candidates. Phone already has usage access and is recording; Pad remains disabled/default permission. No system permissions were changed. Android observations reached OMEN through encrypted usage sync. Evidence/helpers: ignored .local/sync-config-20261029/.
- 2026-10-29 authorized0.4.8/code15 delivery complete: all five devices (OMEN/ROG/Mac arm64/Pad 6 Pro/Redmi K70) are upgraded in place. Three desktops are connected with1188 tasks/1004 manual records, preserving OMEN's2 conflicts; Android UIDs10414/10812 and firstInstallTime remain unchanged, Pad widget id253/provider/host retained. Local Windows/Android/Mac builds and smoke checks pass, with139 Node/78 browser/22 Android/36 Rust tests. CI40814957526 attempt2 succeeded on all four platforms; Intel Mac initially timed out on5-second heading readiness, then passed without test/code changes. Release v0.4.8 targets8c54a7b with14 uploaded assets. Version metadata only changed; no feature/configuration changes. Recovery copies remain under each host's temporary .agents/dayweave-upgrade-0.4.8-*.
- Historical0.4.7/code14 delivery: all five devices were updated in place, Release v0.4.7 targets f99ba9e with14 assets; CI40810456129 succeeded with139 Node/78 browser/22 Android/36 Rust tests. Pairing/data/widgets and OMEN's2 conflicts were preserved.
- Multi-address sync strictly follows configured order on every exchange, with no direct/public classification, sticky promotion or mDNS replacement. Business and automatic-record sync share the list. The live Tailscale/public order is recorded above. Edit Settings / device sync / change sync address, one address per line, without re-pairing. Normal tray restarts removed temporary CDP48739; no desktop shortcuts, system-permission grants or unrelated service changes.
- Historical0.4.6/code13 source a791539 had CI40803789592 cancelled and no Release. The earlier stop was superseded for the authorized0.4.7 delivery; no rollback.
- Historical baseline before the stopped 0.4.6 attempt: 0.4.5 / Android code12, installed in place on OMEN, ROG, Mac arm64, Pad 6 Pro and Redmi K70. Pairing and Android UID/firstInstallTime preserved; desktop state converged to 1188 tasks/1004 manual records, OMEN retains its two old conflicts. Release v0.4.5 has 14 assets; four-platform CI40796337549 succeeded. Timeline summaries/display options, positive-time displays, normal JSON load/export and separate usage-sync UI removed. Ignored apps use searchable icon/name/identity checkbox drafts; global Sync includes `/usage`. Android local queries/configuration collect independently of network and first enable reads available last-seven-day events. Both Android devices still require usage-access permission; Mac new collector requires Accessibility after normal restart. Permission actions never grant access automatically.
- Historical 2026-10-28 build 0.4.4 / Android code11 was installed on all five devices, preserving 1187 tasks/1004 manual records, pairing, Android UID/firstInstallTime and existing tablet widget binding. Desktop profile/bundle backups remain under each host's temporary `.agents/dayweave-upgrade-0.4.4-*`; 0.4.5 recovery copies use the corresponding 0.4.5 prefix.
- Automatic records use independent SQLite, native collectors, three timeline modes, statistics and encrypted `/usage`. OMEN native capture is recording; ROG is locked; Mac displays existing Work Review/local history but its new collector awaits Accessibility. Mac's stale hotspot endpoint `http://192.168.137.2:49732` was replaced through the existing app bridge with the public Web endpoint; normal tray restart is connected and global sync succeeds. OMEN/Mac each held 184626 observations at acceptance, client pending0; counts continue growing. Browser URL, screenshots and OCR remain off; old collectors/profiles untouched. Old/new producer IDs remain separate sources, not physical-device aliases; coverage is interval-unioned. Read `docs/design/automatic-records.md` before changing this boundary.
- Public endpoint is `https://cdn.u3146344.nyat.app:63573/dayweave`, reused Web tunnel 29675319; Tailscale tunnel 29674979 unchanged. `DayweaveHttpsGateway` owns loopback 18781, original subscription publisher moved to loopback 18782 via its task's process-only preload. All eight public subscription bodies remain identical. No new tunnel, purchase, global environment change or AI API exposure. Read `docs/design/https-gateway.md` before service changes. Temporary desktop CDP flags/forwarding are removed after acceptance; OMEN currently starts with process-only API port48731 to avoid the existing Windows exclusion.

- Historical five-device checkpoint 2026-10-27: 0.4.3 / Android code10 installed in place, preserving identities and Android firstInstallTime/widgets. Older version/install statements below are historical. `/health` still reports a hard-coded old version; inspect the installed binary/bundle version. Windows excludes 49692-49791 on OMEN; no system port settings changed.

- Derived from clean Clearlist v0.2.0 history and complete MIT Open Timelog v0.2.0 module. Independent IDs org.dayweave.desktop/mobile and profile Dayweave preserve the original apps.
- Unified version-1 JSON state adds timelog, schedule and an explicit schedule timezone (default Asia/Shanghai). Instants remain UTC epoch; calendar rules use the selected zone, never host timezone.
- Repository: https://github.com/AlexbeatsZ/dayweave, own main.
- Layout baseline since 0.4.2: one responsive page tree for phone and PC, with tasks/records/arrangements/statistics. PC has a permanent sidebar with context categories/settings, no collapse; phone has a bottom bar/drawer. Resizing across 700 px preserves navigation, timer and task drafts. Natural-week plans, due-null inbox, shared create/edit task draft, optional effort minutes, list/activity mappings, four color categories, long-press ordering with visible ordinals and animated tabs. Completed items stay gray at the bottom only in daily/weekly plans. See mobile-interface.md and architecture.md before changing interactions.
- Included task UI fix: parent tasks, inline subtasks and editor drafts share TaskCheck. Ordinary task views show checkable children; list changes persist through the unified store, editor changes remain draft-only until Save. Phone sidebar opens with the menu button; no swipe-to-open gesture.
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

- 0.4.9 delivery/publication is complete. User's actual installed-layout, background/cold-boot and permission-dependent capture acceptance remain separate; future feature builds/deployments still require explicit authorization.

- Delivered in0.4.9: course and usage views share interval-lanes.ts with caller-owned tie ordering; CourseImport owns explicit read/preview/save/cancel and refresh pause. Existing merge/ownership transaction stays unchanged. Saving previews cannot close early; late reads after unmount are ignored. Cancel/error resumes a canceled in-flight refresh through existing checkPending.

- Delivered in0.4.9: four responsive settings categories, shared native Modal, isolated API panel and ListModal, scoped styles and aligned capture controls. Drafts survive category/breakpoint switches; nested Escape does not close the parent. Installed UI experience remains user-reviewed, not proven by automated tests. Follow-up reuse boundaries: docs/design/settings.md.

- 0.4.8 build/publication/five-device deployment is complete. Evidence/scripts are in ignored .local/deploy-0.4.8/ and shared helpers .local/deploy-0.4.6-final/. Physical multi-network/Android background/cold-boot and user's installed-layout acceptance remain separate. No new system permissions, shortcuts or unrelated service changes.
- The requested Tailscale-first/public-second configuration is complete on all four clients, with the existing ROG hub unchanged. Pad public fallback and phone pairing/business/automatic exchange are observed; deliberate network disconnection, Android background/cold boot and the user's installed-layout review remain unverified. No system permissions or conflict resets are authorized. This configuration-only follow-up requires no new package or release.
- Delivered layout: all devices share one automatic-record region; overlap clusters keep fixed equal-width rectangular lanes across the full card duration. A standalone card fills100%; 1-4 and2-5 share50% each, leaving blank ends instead of expanding segments. Phone timeline has no page-level or internal horizontal scrolling; click opens full details. The78-browser regression includes360/390/430px dense-card and staggered geometry cases. Keep the adaptive shared clock, no headers/device dropdown/settings shortcuts. Preview .local/preview/timeline-fit/phone-staggered.png.

- Historical 0.4.5 acceptance before partial 0.4.6 deployment: all five devices were upgraded to 0.4.5 / code12; desktop storage, pairing, task/timelog parity and global usage exchange are verified. Mac installed automatic timeline renders real observations without summaries or load controls; temporary CDP flags/forwarding removed. Android usage permissions and foreground/background/mobile-public-network acceptance, Mac new native capture after Accessibility, and cold boot remain pending. Old generated-build cleanup was rejected by executor policy; previous release/.local build artifacts remain. Do not delete profile/bundle recovery backups as build cleanup.
- Old Work Review and Dayweave collector device IDs are not automatically aliased to one physical device; do not claim physical-device cumulative deduplication across these two producer identities. Native ROG new-window capture was not exercised while locked. Advanced legacy rules/report UI, screenshots/OCR and new Android media production remain outside this integration.

- Real installed-app Fudan capture, physical gestures and new-field cross-device acceptance remain pending. Chrome DOM/API and minimal conversion replay are verified separately; current pairing state belongs to the deployment/sync log and is not changed by this capture fix.
- LAN direct pairing works. Automatic mDNS discovery on the actual LAN remains unconfirmed. Android target is open/resume plus continuous foreground synchronization; background/closed may pause and retry on resume. Background realtime is not a goal; mobile clients must not require a companion tunnel app for HTTPS.
- Preserve keys only under ignored .local. Keep original repos/profiles untouched.

# Build / Run / Test

- Delivery gate (explicit user correction): do not build, package, publish, deploy or push changes that trigger build CI without the user's explicit authorization after UI review. Source edits and previews come first; tests passing do not mean the UI is accepted. Do not create desktop shortcuts during deployment; NSIS createDesktopShortcut is false. Do not roll back the partial 0.4.6 deployment without permission.
- Automatic records: `npm run build:collector` before desktop packaging (Rust toolchain required); `cargo test --manifest-path native/collector/Cargo.toml --locked --workspace`; `npm run test:e2e -- tests/e2e/usage.spec.ts tests/e2e/usage-settings.spec.ts`. Automated capture tests use isolated profiles. Browser build only views historical usage; internal import adapters remain for migration/tests, not native capture/sync.

- npm ci; npm test; npm run build; npm run test:e2e; npm run test:api.
- npm run dist:win; npm run dist:android; npm run dist:mac (macOS). Packaging does not authorize installation/publication.
- Fudan changes: npm run test:e2e -- tests/e2e/fudan-refresh.spec.ts; npm run build; node scripts/smoke-fudan.mjs; Android testDebugUnitTest.
- Tests use DAYWEAVE_DATA_DIR under a dedicated temporary directory. Never use a live profile.

# Architecture Principles

- Settings controls belong only to global Settings: local capture enable/disable, capture status, permissions and sampling/privacy configuration must not be added to the timeline as shortcuts or prompts. Timeline has no device dropdown or top column-identification bar; keep source modes, dates and record actions. Do not add explanatory copy, summaries or replacement labels to compensate.
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

- docs/design/settings.md: settings categories, draft ownership, shared modal/style boundaries and prioritized reuse/decoupling review.

- docs/design/automatic-records.md: native collectors, AW/Work Review adapters, aligned timeline, separate SQLite ownership, usage sync, privacy and acceptance limits.

- docs/design/integration.md: unified state, migration, timezone, widget and API contracts.
- docs/design/storage.md: inherited durable task storage.
- docs/design/timelog-domain.md: time segments and goals.
- docs/design/platforms.md: mobile/desktop platforms.
- docs/design/mobile-interface.md: phone layouts, navigation, sheets, native back, timeline/analytics and narrow-screen checks.
- docs/design/architecture.md: module ownership, shared UI behavior and consolidation rules.
- docs/design/timelog-interface.md: records, timers, goals and analysis UI.
- docs/design/sync.md: ROG hub, discovery, encryption, conflict/sequence rules and mobile foreground boundary.
- docs/design/automatic-records.md: native observation collection, source imports, aligned timelines, statistics and usage sync.
- docs/design/https-gateway.md: fixed ROG HTTPS routes, shared Web ingress, service ownership and recovery.
- docs/design/fudan-import.md: official login windows, minimal capture, pure conversion, preview and acceptance limits.
