# Source attribution

Dayweave combines Clearlist (MIT, Clearlist contributors) and Open Timelog (MIT, Open Timelog contributors), independently developed open-source projects by AlexbeatsZ. Original copyright notices are retained. No proprietary application source or assets are included.

- https://github.com/AlexbeatsZ/clearlist
- https://github.com/AlexbeatsZ/open-timelog

## Automatic activity collection

- The native collector under `native/collector` is adapted from the user's Work Review project at https://github.com/AlexbeatsZ/work-review, source commit `4d3a4033c629695902d5a83c827efc8e478c2267`. The Dayweave integration changes lifecycle, browser opt-in and privacy filtering; it does not embed the old server or dashboard. The supplied Work Review source has no root license declaration; this attribution does not assert a new license for that source. Do not redistribute it as a separately relicensed third-party package.
- `android/app/src/main/java/org/dayweave/mobile/BrowserAddress.java` and the Via address-bar selection in `UsageBrowserService.java` adapt ActivityWatch Android's Via watcher from https://github.com/AlexbeatsZ/aw-android at commit `683d9700d878303ec0176b04c15f681a39e7ed12`, branch `feat/via-browser-sync`. These two files are available under the Mozilla Public License 2.0, retained in `licenses/MPL-2.0.txt`. Their corresponding source is distributed in this repository at the paths above. The remaining application license does not override their MPL terms.
- Rust dependency versions are pinned in `native/collector/Cargo.lock`; each dependency retains its own license. A dependency license bundle is generated alongside the collector when it is built and included in desktop resources.
