#[cfg(any(windows, target_os = "macos", test))]
use work_review_core::model::InputState;
use work_review_core::{config::AgentConfig, model::Activity};

#[cfg(any(windows, target_os = "macos", test))]
const INPUT_GRACE_SECONDS: i64 = 60;

/// A bounded interval clock prevents wake/lock/failure gaps becoming recorded work.
#[derive(Default)]
pub struct CaptureClock {
    previous: Option<i64>,
    #[cfg(any(windows, target_os = "macos", test))]
    foreground: ForegroundClock,
}
impl CaptureClock {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    pub fn advance(&mut self, now: i64, interval: u64) -> Option<(i64, i64)> {
        let previous = self.previous.replace(now)?;
        let delta = now - previous;
        if delta > 0 && delta <= (interval * 2) as i64 {
            Some((previous, delta))
        } else {
            None
        }
    }
}

#[cfg(any(windows, target_os = "macos", test))]
#[derive(Default)]
struct ForegroundClock {
    focus: Option<FocusSample>,
    segment: Option<Activity>,
}

#[cfg(any(windows, target_os = "macos", test))]
struct FocusSample {
    window: usize,
    since: i64,
    at: i64,
    input: Option<i64>,
}

#[cfg(any(windows, target_os = "macos", test))]
impl ForegroundClock {
    fn observe(
        &mut self,
        activity: Activity,
        window: usize,
        now: i64,
        input_age: Option<i64>,
        foreground_only: bool,
        interval: u64,
    ) -> Vec<Activity> {
        let previous = self.focus.take().filter(|sample| {
            sample.window == window && now > sample.at && now - sample.at <= (interval * 2) as i64
        });
        let since = previous.as_ref().map_or(now, |sample| sample.since);
        let input = input_age
            .map(|age| now.saturating_sub(age))
            .filter(|at| *at >= since);
        self.focus = Some(FocusSample {
            window,
            since,
            at: now,
            input,
        });
        let Some(previous) = previous else {
            self.segment = None;
            return Vec::new();
        };
        // A sample can straddle the expiry or a new input after expiry. Split at the
        // event times so the ten-second polling cadence never adds a full sample to the grace.
        let prior_input = previous.input;
        let mut boundaries = vec![previous.at, now];
        for at in [prior_input, input].into_iter().flatten() {
            for boundary in [at, at + INPUT_GRACE_SECONDS] {
                if previous.at < boundary && boundary < now {
                    boundaries.push(boundary);
                }
            }
        }
        boundaries.sort_unstable();
        boundaries.dedup();
        let mut changed: Vec<Activity> = Vec::new();
        for range in boundaries.windows(2) {
            let start = range[0];
            let end = range[1];
            let state = if input_age.is_none() {
                InputState::Unknown
            } else if [prior_input, input]
                .into_iter()
                .flatten()
                .any(|at| at <= start && start < at + INPUT_GRACE_SECONDS)
            {
                InputState::Active
            } else {
                InputState::Idle
            };
            let segment = self.segment.take().filter(|last| {
                last.timestamp + last.duration == start
                    && end - last.timestamp <= 86_400
                    && last.input_state == Some(state)
                    && last.foreground_only == foreground_only
                    && last.app_name == activity.app_name
                    && last.window_title == activity.window_title
                    && last.browser_url == activity.browser_url
                    && last.category == activity.category
            });
            let mut segment = segment.unwrap_or_else(|| Activity {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp: start,
                input_state: Some(state),
                foreground_only,
                ..activity.clone()
            });
            segment.duration = end - segment.timestamp;
            if changed.last().is_some_and(|last| last.id == segment.id) {
                *changed.last_mut().unwrap() = segment.clone();
            } else {
                changed.push(segment.clone());
            }
            self.segment = Some(segment);
        }
        changed
    }
}

#[cfg(target_os = "macos")]
const WINDOW_READ_RESTART_SECONDS: i64 = 180;

pub struct Sample {
    pub activity: Option<Activity>,
    pub foreground: Vec<Activity>,
    pub screenshot_path: Option<std::path::PathBuf>,
    pub state: String,
    pub error: Option<String>,
}

#[cfg(any(windows, target_os = "macos"))]
pub fn sample(
    directory: &std::path::Path,
    config: &AgentConfig,
    clock: &mut CaptureClock,
) -> anyhow::Result<Sample> {
    use crate::{
        idle_detector::IdleDetector, screen_lock::ScreenLockMonitor, screenshot::ScreenshotService,
    };
    use work_review_core::privacy::{PrivacyAction, PrivacyFilter};
    let empty = |state: &str, error: Option<String>| Sample {
        activity: None,
        foreground: Vec::new(),
        screenshot_path: None,
        state: state.into(),
        error,
    };
    if !config.enabled {
        clock.reset();
        return Ok(empty("paused", None));
    }
    if ScreenLockMonitor::new().is_locked() {
        clock.reset();
        return Ok(empty("locked", None));
    }
    let idle = IdleDetector::new(config.idle_threshold_minutes.into()).is_input_idle();
    if idle && !config.observe_foreground_input {
        clock.reset();
        return Ok(empty("idle", None));
    }
    if !crate::screenshot::has_accessibility_permission(false) {
        clock.reset();
        return Ok(empty(
            "permission",
            Some("请在系统设置中为采集程序授予辅助功能权限".into()),
        ));
    }
    let window = match if config.browser_enabled {
        crate::monitor::get_active_window()
    } else {
        crate::monitor::get_active_window_fast()
    } {
        Ok(window) => window,
        Err(error) => {
            clock.reset();
            return Ok(empty("error", Some(format!("前台窗口读取失败: {error}"))));
        }
    };
    #[cfg(target_os = "macos")]
    if let Some(since) = crate::macos_window::window_read_failing_since() {
        // Exiting lets launchd's KeepAlive start a fresh process with a working connection.
        if chrono::Utc::now().timestamp() - since >= WINDOW_READ_RESTART_SECONDS {
            anyhow::bail!("前台窗口标题持续读取失败，重启采集进程");
        }
    }
    if window.is_minimized || crate::monitor::is_system_process(&window.app_name) {
        clock.reset();
        return Ok(empty("idle", None));
    }
    let privacy = PrivacyFilter::from_config(&config.privacy);
    let action = privacy.check_privacy_full(
        &window.app_name,
        &window.window_title,
        window.browser_url.as_deref(),
    );
    if action == PrivacyAction::Skip {
        clock.reset();
        return Ok(empty("private", None));
    }
    let now = chrono::Utc::now().timestamp();
    let (timestamp, duration) = if config.observe_foreground_input {
        (now, 0)
    } else {
        let Some(range) = clock.advance(now, config.screenshot_interval) else {
            return Ok(empty("recording", None));
        };
        range
    };
    let anonymized = action == PrivacyAction::Anonymize;
    let app = crate::monitor::normalize_display_app_name(&window.app_name);
    let mut category = work_review_core::categorize::categorize_app_with_rules(
        &config.app_category_rules,
        &app,
        if anonymized { "" } else { &window.window_title },
        &config.custom_categories,
    );
    if !anonymized {
        if let Some(semantic) = work_review_core::categorize::find_website_semantic_override(
            &config.website_semantic_rules,
            window.browser_url.as_deref(),
        ) {
            category = crate::monitor::semantic_category_to_base_category(&semantic, &category);
        }
    }
    let mut activity = Activity {
        id: uuid::Uuid::new_v4().to_string(),
        device_id: config.device.id.clone(),
        timestamp,
        duration,
        app_name: app,
        window_title: if anonymized {
            String::new()
        } else {
            privacy.filter_text(&window.window_title)
        },
        browser_url: if anonymized || !config.browser_enabled {
            None
        } else {
            window
                .browser_url
                .as_ref()
                .map(|url| privacy.filter_text(url))
        },
        category,
        ocr_text: None,
        screenshot: false,
        note: String::new(),
        input_state: None,
        foreground_only: false,
    };
    if config.observe_foreground_input {
        let input_age = crate::idle_detector::foreground_input_age(window.window_id);
        let foreground = clock.foreground.observe(
            activity,
            window.window_id,
            now,
            input_age,
            idle,
            sample_interval(config),
        );
        return Ok(Sample {
            activity: None,
            foreground,
            screenshot_path: None,
            state: if idle { "idle" } else { "recording" }.into(),
            error: None,
        });
    }
    let mut screenshot_path = None;
    let mut error = None;
    if config.storage.screenshots_enabled && !anonymized {
        if !crate::screenshot::has_screen_capture_permission() {
            error = Some("截图需要系统屏幕录制权限；应用记录仍在继续".into());
        } else {
            match ScreenshotService::new(directory, &config.storage)
                .capture_for_window(Some(&window))
            {
                Ok(image) => {
                    if config.ocr_enabled {
                        let input = image.ocr_source_path.as_ref().unwrap_or(&image.path);
                        match crate::ocr::OcrService::new().extract_text(input) {
                            Ok(Some(result)) => {
                                activity.ocr_text = Some(privacy.filter_text(&result.text))
                            }
                            Ok(None) => {}
                            Err(e) => error = Some(format!("OCR 失败: {e}")),
                        }
                    }
                    if let Some(path) = image.ocr_source_path {
                        let _ = std::fs::remove_file(path);
                    }
                    activity.screenshot = true;
                    screenshot_path = Some(image.path);
                }
                Err(e) => error = Some(format!("截图失败: {e}")),
            }
        }
    }
    Ok(Sample {
        activity: Some(activity),
        foreground: Vec::new(),
        screenshot_path,
        state: "recording".into(),
        error,
    })
}

pub fn sample_interval(config: &AgentConfig) -> u64 {
    if config.observe_foreground_input {
        config.screenshot_interval.min(10)
    } else {
        config.screenshot_interval
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn sample(
    _: &std::path::Path,
    _: &AgentConfig,
    _: &mut CaptureClock,
) -> anyhow::Result<Sample> {
    anyhow::bail!("collectors support Windows and macOS; run the hub on this platform")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample_activity() -> Activity {
        Activity {
            id: String::new(),
            device_id: "test".into(),
            timestamp: 0,
            duration: 0,
            app_name: "Codex".into(),
            window_title: "Workspace".into(),
            browser_url: None,
            category: String::new(),
            ocr_text: None,
            screenshot: false,
            note: String::new(),
            input_state: None,
            foreground_only: false,
        }
    }

    #[test]
    fn input_expiry_splits_the_same_frontmost_window_at_sixty_seconds() {
        let mut clock = ForegroundClock::default();
        let mut sample =
            |time, input| clock.observe(sample_activity(), 1, time, Some(input), false, 10);
        assert!(sample(100, 10).is_empty());
        let first = sample(110, 7);
        assert_eq!(first[0].input_state, Some(InputState::Idle));
        assert_eq!(first[1].timestamp, 103);
        assert_eq!(first[1].input_state, Some(InputState::Active));
        let id = first[1].id.clone();
        for time in [120, 130, 140, 150, 160] {
            let revised = sample(time, time - 103);
            assert_eq!(revised.len(), 1);
            assert_eq!(revised[0].id, id);
        }
        let expired = sample(170, 67);
        assert_eq!(expired[0].id, id);
        assert_eq!(expired[0].duration, 60);
        assert_eq!(expired[1].timestamp, 163);
        assert_eq!(expired[1].input_state, Some(InputState::Idle));
        let renewed = sample(180, 2);
        assert_eq!(renewed[0].id, expired[1].id);
        assert_eq!(renewed[1].timestamp, 178);
        assert_eq!(renewed[1].input_state, Some(InputState::Active));
    }

    #[test]
    fn foreground_switch_does_not_adopt_another_windows_input() {
        let mut clock = ForegroundClock::default();
        let mut sample = |window, time, input| {
            clock.observe(sample_activity(), window, time, Some(input), false, 10)
        };
        sample(1, 100, 0);
        assert_eq!(sample(1, 110, 10)[0].input_state, Some(InputState::Active));
        assert!(sample(2, 120, 20).is_empty());
        assert_eq!(sample(2, 130, 30)[0].input_state, Some(InputState::Idle));
        assert!(sample(2, 1000, 0).is_empty());
    }

    #[test]
    fn sleep_failure_and_reset_do_not_create_work() {
        let mut clock = CaptureClock::default();
        assert_eq!(clock.advance(100, 10), None);
        assert_eq!(clock.advance(110, 10), Some((100, 10)));
        assert_eq!(clock.advance(1000, 10), None);
        clock.reset();
        assert_eq!(clock.advance(1010, 10), None);
        assert_eq!(clock.advance(1005, 10), None);
    }
}
