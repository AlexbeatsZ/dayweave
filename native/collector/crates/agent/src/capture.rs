use work_review_core::{config::AgentConfig, model::Activity};

/// A bounded interval clock prevents wake/lock/failure gaps becoming recorded work.
#[derive(Default)]
pub struct CaptureClock {
    previous: Option<i64>,
}
impl CaptureClock {
    pub fn reset(&mut self) {
        self.previous = None;
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

#[cfg(target_os = "macos")]
const WINDOW_READ_RESTART_SECONDS: i64 = 180;

pub struct Sample {
    pub activity: Option<Activity>,
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
    if IdleDetector::new(config.idle_threshold_minutes.into()).is_input_idle() {
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
    let Some((timestamp, duration)) =
        clock.advance(chrono::Utc::now().timestamp(), config.screenshot_interval)
    else {
        return Ok(empty("recording", None));
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
    };
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
        screenshot_path,
        state: "recording".into(),
        error,
    })
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
