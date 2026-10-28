#[cfg(target_os = "windows")]
use crate::error::AppError;
use crate::error::Result;
use once_cell::sync::Lazy;
use regex::Regex;
#[cfg(any(target_os = "macos", test))]
use serde_json::Value;
#[cfg(any(target_os = "macos", test))]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(any(target_os = "macos", test))]
use std::path::Path;
#[cfg(any(target_os = "macos", test))]
use std::path::PathBuf;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process::{Command, Output};
#[cfg(target_os = "macos")]
use std::sync::Mutex;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::time::Duration;
#[cfg(target_os = "windows")]
use winapi::shared::windef::RECT;
use work_review_core::categorize::normalize_category_key;

#[cfg(any(target_os = "macos", target_os = "windows"))]
const MONITOR_COMMAND_TIMEOUT: Duration = Duration::from_millis(1200);

static URL_LIKE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?i)(https?://[^\s<>"']+|(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d{2,5})?(?:/[^\s<>"']*)?)"#,
    )
    .expect("URL regex should compile")
});

#[cfg(target_os = "macos")]
static LAST_BROWSER_URL_LOGS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[cfg(any(target_os = "macos", test))]
fn remember_browser_url_log(cache: &mut HashMap<String, String>, key: &str, url: &str) -> bool {
    const MAX_ENTRIES: usize = 256;
    match cache.get(key) {
        Some(previous) if previous == url => false,
        _ => {
            if cache.len() >= MAX_ENTRIES {
                cache.clear();
            }
            cache.insert(key.to_string(), url.to_string());
            true
        }
    }
}

#[cfg(target_os = "macos")]
fn log_browser_url_once(log_key: &str, message: &str, url: &str) {
    let mut cache = LAST_BROWSER_URL_LOGS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if remember_browser_url_log(&mut cache, log_key, url) {
        let _ = (message, url);
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn run_monitor_command_with_timeout(command: &mut Command, context: &str) -> Result<Output> {
    crate::command::run(command, MONITOR_COMMAND_TIMEOUT, context)
}

/// 活动窗口信息
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 活动窗口信息
#[derive(Debug, Clone)]
pub struct ActiveWindow {
    pub app_name: String,
    pub window_title: String,
    /// 浏览器 URL（如果当前应用是浏览器）
    pub browser_url: Option<String>,
    /// 当前窗口对应的可执行文件路径（Windows 优先）
    pub executable_path: Option<String>,
    /// 当前窗口的全局坐标和尺寸，用于多屏幕选屏截图
    pub window_bounds: Option<WindowBounds>,
    /// 当前前台窗口是否已最小化（Windows “显示桌面”时最后一个窗口仍可能保持前台）
    pub is_minimized: bool,
}

pub use work_review_core::categorize::{is_browser_app, is_system_process};

/// 清理浏览器窗口标题中的内部页面信息。
/// Chrome 等浏览器会把内存警告、标签页计数等信息拼到窗口标题里，
/// 例如 "文档查看 - 内存用量高 - 841 MB - Google Chrome - momoi (行走的卫星)"
/// 清理后只保留有意义的页面标题。
pub fn clean_browser_window_title(title: &str, app_name: &str) -> String {
    if !is_browser_app(app_name) || title.is_empty() {
        return title.to_string();
    }

    let app_name_lower = app_name.to_lowercase();
    let browser_suffix = if app_name_lower.contains("chrome") {
        "Google Chrome"
    } else if app_name_lower.contains("msedge") || app_name_lower.contains("microsoft edge") {
        "Microsoft Edge"
    } else if app_name_lower.contains("brave") {
        "Brave"
    } else if app_name_lower.contains("opera") {
        "Opera"
    } else if app_name_lower.contains("vivaldi") {
        "Vivaldi"
    } else if app_name_lower.contains("firefox") {
        "Firefox"
    } else if app_name_lower.contains("safari") {
        "Safari"
    } else if app_name_lower.contains("arc") {
        "Arc"
    } else {
        ""
    };

    // 按 " - " 分段，过滤掉浏览器内部信息段
    let segments: Vec<&str> = title.split(" - ").collect();
    if segments.len() <= 1 {
        return title.to_string();
    }

    let mut clean_segments: Vec<&str> = Vec::new();

    for seg in &segments {
        let seg_trimmed = seg.trim();

        // 跳过浏览器名本身（如 "Google Chrome"）
        if !browser_suffix.is_empty() && seg_trimmed == browser_suffix {
            continue;
        }

        // 跳过内存/性能警告："内存用量高 - 841 MB", "Memory usage high - 841 MB"
        if is_browser_internal_segment(seg_trimmed) {
            continue;
        }

        clean_segments.push(seg_trimmed);
    }

    if clean_segments.is_empty() {
        return title.to_string();
    }

    clean_segments.join(" - ")
}

fn is_size_value(s: &str) -> bool {
    let s = s.trim();
    let suffixes = ["kb", "mb", "gb", "tb"];
    for suffix in &suffixes {
        if let Some(num_part) = s.strip_suffix(suffix) {
            let num_part = num_part.trim();
            if num_part.parse::<f64>().is_ok() {
                return true;
            }
        }
    }
    false
}

/// 判断是否是浏览器窗口标题中的内部信息段（非页面标题）
fn is_browser_internal_segment(segment: &str) -> bool {
    let lower = segment.to_lowercase();

    // 内存/性能警告
    let memory_patterns = [
        "内存用量高",
        "内存使用量高",
        "内存不足",
        "memory usage high",
        "memory low",
        "high memory",
        "out of memory",
    ];
    for pat in &memory_patterns {
        if lower.contains(pat) {
            return true;
        }
    }

    // 纯数字 + 单位 (如 "841 MB", "1.2 GB")——内存警告的数值段
    if is_size_value(&lower) {
        return true;
    }

    // 标签页/窗口计数 (如 "3 个标签页", "2 tabs", "(3)")
    let tab_patterns = ["个标签页", "個分頁", "tabs", "tab"];
    for pat in &tab_patterns {
        if lower.contains(pat) && lower.len() < 20 {
            return true;
        }
    }

    // chrome:// internal pages
    if lower.starts_with("chrome://") || lower.starts_with("edge://") || lower.starts_with("about:")
    {
        return true;
    }

    false
}

/// 统一应用显示名称，避免不同来源（进程名、数据库历史、运行中列表）出现重复项
pub use work_review_core::categorize::normalize_display_app_name;

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn is_probable_domain(value: &str) -> bool {
    let candidate = value.trim().trim_matches('/').to_lowercase();
    if candidate.is_empty()
        || candidate.contains(' ')
        || candidate.starts_with('.')
        || candidate.ends_with('.')
        || !candidate.contains('.')
    {
        return false;
    }

    let labels: Vec<&str> = candidate.split('.').collect();
    if labels.len() < 2 {
        return false;
    }

    let tld = labels.last().copied().unwrap_or_default();
    // TLD 最少 2 字符、最多 12 字符，且必须全是 ASCII 字母
    // 上限防止 OCR 丢失斜杠后把域名和路径拼为超长假 TLD（如 github.comwm94i）
    if tld.len() < 2 || tld.len() > 12 || !tld.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }

    labels.iter().all(|label| {
        !label.is_empty()
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn trim_url_candidate(value: &str) -> &str {
    value.trim().trim_matches(|c: char| {
        matches!(
            c,
            '"' | '\'' | '`' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | ',' | ';'
        )
    })
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn split_host_and_rest(value: &str) -> (&str, &str) {
    if let Some(index) = value.find(|c| ['/', '?', '#'].contains(&c)) {
        (&value[..index], &value[index..])
    } else {
        (value, "")
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn split_host_port(value: &str) -> (&str, Option<&str>) {
    if let Some(index) = value.rfind(':') {
        let host = &value[..index];
        let port = &value[index + 1..];
        if !host.is_empty() && !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) {
            return (host, Some(port));
        }
    }

    (value, None)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn is_probable_ipv4(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() != 4 {
        return false;
    }

    parts.iter().all(|part| {
        !part.is_empty()
            && part.len() <= 3
            && part.chars().all(|c| c.is_ascii_digit())
            && part.parse::<u8>().is_ok()
    })
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn is_probable_host(value: &str) -> bool {
    let host = value.trim().trim_end_matches('.');
    if host.is_empty() {
        return false;
    }

    let (host_without_port, _) = split_host_port(host);
    let host_lower = host_without_port.to_lowercase();

    host_lower == "localhost"
        || is_probable_domain(host_without_port)
        || is_probable_ipv4(host_without_port)
}

/// Detect host-only domains that are likely OCR slash-loss artifacts
/// e.g. `linux.do/latest` → OCR loses `/` → `linux.dolatest`
fn is_merged_domain(url: &str) -> bool {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);

    let (host, rest) = split_host_and_rest(without_scheme);
    if !rest.is_empty() {
        return false;
    }

    let host = split_host_port(host).0.trim_end_matches('.');
    if host.is_empty() || host == "localhost" {
        return false;
    }

    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() != 2 {
        return false;
    }

    let tld = labels[1].to_lowercase();
    if tld.len() <= 6 || !tld.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }

    let prefix = &tld[..2];
    matches!(
        prefix,
        "ai" | "cc"
            | "cn"
            | "de"
            | "do"
            | "fr"
            | "hk"
            | "id"
            | "in"
            | "io"
            | "jp"
            | "kr"
            | "me"
            | "ru"
            | "sg"
            | "tv"
            | "uk"
            | "us"
    )
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn normalize_possible_url(value: &str) -> Option<String> {
    let candidate = trim_url_candidate(value)
        .trim_matches(|c: char| c.is_control() || c == '\u{200b}' || c == '\u{feff}')
        .trim_end_matches('.');

    if candidate.is_empty() {
        return None;
    }

    if candidate.contains(' ') {
        return None;
    }

    let candidate_lower = candidate.to_lowercase();
    if candidate_lower.starts_with("http://") || candidate_lower.starts_with("https://") {
        return Some(candidate.to_string());
    }

    if candidate.contains("://")
        || candidate_lower.starts_with("about:")
        || candidate_lower.starts_with("chrome:")
        || candidate_lower.starts_with("edge:")
        || candidate_lower.starts_with("file:")
    {
        return Some(candidate.to_string());
    }

    let (host, _) = split_host_and_rest(candidate);
    if is_probable_host(host) {
        let result = format!(
            "{}{}",
            if split_host_port(host).0.to_lowercase() == "localhost"
                || is_probable_ipv4(split_host_port(host).0)
            {
                "http://"
            } else {
                "https://"
            },
            candidate.trim_end_matches('/')
        );
        if is_merged_domain(&result) {
            return None;
        }
        return Some(result);
    }

    if is_probable_domain(candidate) {
        let result = format!("https://{}", candidate.trim_end_matches('/'));
        if is_merged_domain(&result) {
            return None;
        }
        return Some(result);
    }

    None
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn extract_url_from_text(text: &str) -> Option<String> {
    URL_LIKE_RE
        .find_iter(text)
        .filter_map(|m| normalize_possible_url(m.as_str()))
        .next()
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn infer_browser_page_hint(window_title: &str) -> Option<String> {
    extract_url_from_title(window_title)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn infer_browser_page_hint_from_text(text: &str) -> Option<String> {
    extract_url_from_text(text)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn browser_page_domain_label(page_hint: &str) -> String {
    if let Some(url) = normalize_possible_url(page_hint) {
        let without_scheme = url
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(url.as_str());
        let (host, _) = split_host_and_rest(without_scheme);
        return split_host_port(host).0.to_string();
    }

    page_hint.trim().to_string()
}

pub fn normalize_domain_rule(value: &str) -> Option<String> {
    let domain = browser_page_domain_label(value).trim().to_lowercase();
    if domain.is_empty() {
        None
    } else {
        Some(domain)
    }
}

pub fn find_website_semantic_override(
    rules: &[crate::config::WebsiteSemanticRule],
    browser_url: Option<&str>,
) -> Option<String> {
    let target_domain = browser_url.and_then(normalize_domain_rule)?;

    rules.iter().find_map(|rule| {
        let rule_domain = normalize_domain_rule(&rule.domain)?;
        if rule_domain == target_domain {
            Some(rule.semantic_category.trim().to_string())
        } else {
            None
        }
    })
}

/// 将网站语义分类映射到基础分类，便于工作/休息时长统计直接生效。
/// 对无法识别的语义分类，保留原有基础分类。
pub fn semantic_category_to_base_category(
    semantic_category: &str,
    fallback_category: &str,
) -> String {
    let semantic = semantic_category.trim();
    if semantic.is_empty() {
        return normalize_category_key(fallback_category);
    }

    let mapped = match semantic {
        "休息娱乐" | "视频内容" | "音乐音频" => Some("entertainment"),
        "即时聊天" | "会议沟通" => Some("communication"),
        "设计创作" => Some("design"),
        "编码开发" => Some("development"),
        "内容撰写" => Some("office"),
        "资料阅读" | "资料调研" | "任务规划" | "AI 协作" | "未知活动" => {
            Some("browser")
        }
        _ => None,
    };

    if let Some(category) = mapped {
        return category.to_string();
    }

    let fallback = fallback_category.trim().to_lowercase();
    let normalized = normalize_category_key(&fallback);
    if normalized == "other" && !fallback.is_empty() && fallback != "other" {
        // 保留可能存在的自定义分类 key。
        fallback
    } else {
        normalized
    }
}

#[cfg(any(target_os = "macos", test))]
fn firefox_family_profile_dir_from_ini(base_dir: &Path, ini_content: &str) -> Option<PathBuf> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum SectionKind {
        Other,
        Install,
        Profile,
    }

    let mut section = SectionKind::Other;
    let mut install_default_path: Option<String> = None;
    let mut profile_path: Option<String> = None;
    let mut profile_is_relative = true;
    let mut profile_is_default = false;
    let mut default_profile_path: Option<String> = None;
    let mut first_profile_path: Option<String> = None;

    let finalize_profile = |profile_path: &mut Option<String>,
                            profile_is_relative: &mut bool,
                            profile_is_default: &mut bool,
                            default_profile_path: &mut Option<String>,
                            first_profile_path: &mut Option<String>| {
        let Some(path) = profile_path.take() else {
            *profile_is_relative = true;
            *profile_is_default = false;
            return;
        };

        let resolved = if *profile_is_relative {
            base_dir.join(&path)
        } else {
            PathBuf::from(&path)
        };

        if first_profile_path.is_none() {
            *first_profile_path = Some(resolved.to_string_lossy().to_string());
        }
        if *profile_is_default {
            *default_profile_path = Some(resolved.to_string_lossy().to_string());
        }

        *profile_is_relative = true;
        *profile_is_default = false;
    };

    for raw_line in ini_content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            if section == SectionKind::Profile {
                finalize_profile(
                    &mut profile_path,
                    &mut profile_is_relative,
                    &mut profile_is_default,
                    &mut default_profile_path,
                    &mut first_profile_path,
                );
            }

            let section_name = &line[1..line.len() - 1];
            section = if section_name.starts_with("Install") {
                SectionKind::Install
            } else if section_name.starts_with("Profile") {
                SectionKind::Profile
            } else {
                SectionKind::Other
            };
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();

        match section {
            SectionKind::Install if key == "Default" => {
                install_default_path = Some(base_dir.join(value).to_string_lossy().to_string());
            }
            SectionKind::Profile => match key {
                "Path" => profile_path = Some(value.to_string()),
                "IsRelative" => profile_is_relative = value != "0",
                "Default" => profile_is_default = value == "1",
                _ => {}
            },
            SectionKind::Other | SectionKind::Install => {}
        }
    }

    if section == SectionKind::Profile {
        finalize_profile(
            &mut profile_path,
            &mut profile_is_relative,
            &mut profile_is_default,
            &mut default_profile_path,
            &mut first_profile_path,
        );
    }

    install_default_path
        .or(default_profile_path)
        .or(first_profile_path)
        .map(PathBuf::from)
}

#[cfg(any(target_os = "macos", test))]
fn decode_mozlz4_bytes(data: &[u8]) -> std::result::Result<Vec<u8>, String> {
    const HEADER: &[u8; 8] = b"mozLz40\0";

    if data.len() < 12 {
        return Err("mozlz4 数据长度不足".to_string());
    }
    if &data[..8] != HEADER {
        return Err("mozlz4 文件头不匹配".to_string());
    }

    let expected_len = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
    let src = &data[12..];
    let mut out = Vec::with_capacity(expected_len);
    let mut index = 0usize;

    while index < src.len() {
        let token = src[index];
        index += 1;

        let mut literal_len = (token >> 4) as usize;
        if literal_len == 15 {
            loop {
                let extra = *src
                    .get(index)
                    .ok_or_else(|| "mozlz4 字面量长度越界".to_string())?;
                index += 1;
                literal_len += extra as usize;
                if extra != 255 {
                    break;
                }
            }
        }

        let literal_end = index + literal_len;
        if literal_end > src.len() {
            return Err("mozlz4 字面量块越界".to_string());
        }
        out.extend_from_slice(&src[index..literal_end]);
        index = literal_end;

        if index >= src.len() {
            break;
        }

        let offset = u16::from_le_bytes([
            *src.get(index)
                .ok_or_else(|| "mozlz4 offset 越界".to_string())?,
            *src.get(index + 1)
                .ok_or_else(|| "mozlz4 offset 越界".to_string())?,
        ]) as usize;
        index += 2;

        if offset == 0 || offset > out.len() {
            return Err("mozlz4 offset 非法".to_string());
        }

        let mut match_len = (token & 0x0F) as usize;
        if match_len == 15 {
            loop {
                let extra = *src
                    .get(index)
                    .ok_or_else(|| "mozlz4 匹配长度越界".to_string())?;
                index += 1;
                match_len += extra as usize;
                if extra != 255 {
                    break;
                }
            }
        }
        match_len += 4;

        let mut match_index = out.len() - offset;
        for _ in 0..match_len {
            let value = *out
                .get(match_index)
                .ok_or_else(|| "mozlz4 匹配引用越界".to_string())?;
            out.push(value);
            match_index += 1;
        }
    }

    if out.len() != expected_len {
        return Err(format!(
            "mozlz4 解码长度不匹配: expected={}, actual={}",
            expected_len,
            out.len()
        ));
    }

    Ok(out)
}

#[cfg(any(target_os = "macos", test))]
fn normalize_session_store_title(value: &str) -> String {
    value
        .split(" - Mozilla Firefox")
        .next()
        .unwrap_or(value)
        .split(" - Firefox")
        .next()
        .unwrap_or(value)
        .split(" - Zen Browser")
        .next()
        .unwrap_or(value)
        .split(" - Zen")
        .next()
        .unwrap_or(value)
        .trim()
        .to_string()
}

#[cfg(any(target_os = "macos", test))]
fn extract_active_tab_url_from_session_store_value(
    value: &Value,
    window_title: &str,
) -> Option<String> {
    let windows = value.get("windows")?.as_array()?;
    if windows.is_empty() {
        return None;
    }

    let selected_window_index = value
        .get("selectedWindow")
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        .saturating_sub(1) as usize;
    let normalized_window_title = normalize_session_store_title(window_title);
    let mut best_match: Option<(i32, u64, String)> = None;

    for (window_index, window) in windows.iter().enumerate() {
        let Some(tabs) = window.get("tabs").and_then(|v| v.as_array()) else {
            continue;
        };

        let selected_tab_index = window
            .get("selected")
            .and_then(|v| v.as_u64())
            .unwrap_or(1)
            .saturating_sub(1) as usize;

        for (tab_index, tab) in tabs.iter().enumerate() {
            let Some(entries) = tab.get("entries").and_then(|v| v.as_array()) else {
                continue;
            };
            if entries.is_empty() {
                continue;
            }

            let selected_entry_index = tab
                .get("index")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .saturating_sub(1) as usize;
            let entry = entries
                .get(selected_entry_index)
                .or_else(|| entries.last())
                .unwrap_or(&entries[0]);

            let Some(raw_url) = entry.get("url").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(url) = normalize_possible_url(raw_url) else {
                continue;
            };

            let entry_title = entry
                .get("title")
                .and_then(|v| v.as_str())
                .map(normalize_session_store_title)
                .unwrap_or_default();
            let last_accessed = tab
                .get("lastAccessed")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            let mut score = 0i32;
            if !normalized_window_title.is_empty() && !entry_title.is_empty() {
                if entry_title == normalized_window_title {
                    score += 1_000;
                } else if entry_title.contains(&normalized_window_title)
                    || normalized_window_title.contains(&entry_title)
                {
                    score += 600;
                }
            }
            if window_index == selected_window_index {
                score += 120;
            }
            if tab_index == selected_tab_index {
                score += 80;
            }
            if !tab.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false) {
                score += 20;
            }
            if raw_url.starts_with("http://") || raw_url.starts_with("https://") {
                score += 20;
            }

            let replace = best_match
                .as_ref()
                .map(|(best_score, best_last_accessed, _)| {
                    score > *best_score
                        || (score == *best_score && last_accessed > *best_last_accessed)
                })
                .unwrap_or(true);

            if replace {
                best_match = Some((score, last_accessed, url));
            }
        }
    }

    best_match.map(|(_, _, url)| url)
}

#[cfg(target_os = "macos")]
fn firefox_family_session_store_base_dir(app_lower: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let app_support_dir = dirs::data_dir()?;

        if app_lower.contains("firefox") {
            Some(app_support_dir.join("Firefox"))
        } else if app_lower.contains("zen") {
            Some(app_support_dir.join("Zen"))
        } else {
            None
        }
    }

    #[cfg(target_os = "windows")]
    {
        let _ = app_lower;
        None
    }
}

#[cfg(target_os = "macos")]
fn firefox_family_session_store_url(app_name: &str, window_title: &str) -> Option<String> {
    let app_lower = app_name.to_lowercase();
    let base_dir = firefox_family_session_store_base_dir(&app_lower)?;
    let ini_path = base_dir.join("profiles.ini");
    let ini_content = std::fs::read_to_string(&ini_path).ok()?;
    let profile_dir = firefox_family_profile_dir_from_ini(&base_dir, &ini_content)?;

    let session_paths = [
        profile_dir.join("sessionstore-backups/recovery.jsonlz4"),
        profile_dir.join("sessionstore.jsonlz4"),
    ];

    for session_path in session_paths {
        let Ok(raw) = std::fs::read(&session_path) else {
            continue;
        };
        let Ok(decoded) = decode_mozlz4_bytes(&raw) else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<Value>(&decoded) else {
            continue;
        };
        if let Some(url) = extract_active_tab_url_from_session_store_value(&value, window_title) {
            log_browser_url_once(
                &format!("sessionstore:{app_name}"),
                &format!("从 sessionstore 获取到 {app_name} URL"),
                &url,
            );
            return Some(url);
        }
    }

    None
}

/// 获取当前活动窗口信息
#[cfg(target_os = "windows")]
pub fn get_active_window() -> Result<ActiveWindow> {
    get_active_window_with_options(true)
}

#[cfg(target_os = "windows")]
pub fn get_active_window_fast() -> Result<ActiveWindow> {
    get_active_window_with_options(false)
}

#[cfg(target_os = "windows")]
fn get_active_window_with_options(include_browser_url: bool) -> Result<ActiveWindow> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::psapi::GetModuleBaseNameW;
    use winapi::um::winnt::PROCESS_QUERY_INFORMATION;
    use winapi::um::winuser::{
        GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
    };
    // PROCESS_QUERY_LIMITED_INFORMATION 是 Vista+ 专为低权限场景设计的标志
    // 无需 PROCESS_VM_READ，对 UAC 保护进程、Store 应用等成功率远高于完整权限
    const PROCESS_QUERY_LIMITED: u32 = 0x1000;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            // null HWND 出现在睡眠/现代待机唤醒、UAC弹窗、窗口切换瞬间等场景
            // 此时没有真实的前台窗口，不应伪造应用名，由调用方决定如何处理
            return Err(AppError::Unknown("没有前台窗口".to_string()));
        }

        // 获取窗口标题
        let mut title: [u16; 512] = [0; 512];
        let len = GetWindowTextW(hwnd, title.as_mut_ptr(), 512);
        let window_title = if len > 0 {
            OsString::from_wide(&title[..len as usize])
                .to_string_lossy()
                .to_string()
        } else {
            String::new()
        };

        // 获取进程ID
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);

        let executable_path = if pid > 0 {
            get_process_image_path(pid)
        } else {
            None
        };

        // 获取进程名，使用多级备用策略确保 Win10 低权限下能正确读取
        let raw_app_name = if pid > 0 {
            // 方法一：PROCESS_QUERY_LIMITED_INFORMATION + GetModuleBaseNameW
            // 对大多数普通进程（Word、VSCode、WPS 等）有效
            let handle = OpenProcess(PROCESS_QUERY_LIMITED, 0, pid);
            let name_opt = if !handle.is_null() {
                let mut name: [u16; 256] = [0; 256];
                let len = GetModuleBaseNameW(handle, std::ptr::null_mut(), name.as_mut_ptr(), 256);
                CloseHandle(handle);
                if len > 0 {
                    Some(
                        OsString::from_wide(&name[..len as usize])
                            .to_string_lossy()
                            .to_string(),
                    )
                } else {
                    None
                }
            } else {
                None
            };

            if let Some(n) = name_opt {
                n
            } else {
                // 方法二：回退完整权限（覆盖 GetModuleBaseNameW 需要 PROCESS_VM_READ 的场景）
                let handle2 = OpenProcess(PROCESS_QUERY_INFORMATION | 0x0010, 0, pid);
                let name_opt2 = if !handle2.is_null() {
                    let mut name: [u16; 256] = [0; 256];
                    let len =
                        GetModuleBaseNameW(handle2, std::ptr::null_mut(), name.as_mut_ptr(), 256);
                    CloseHandle(handle2);
                    if len > 0 {
                        Some(
                            OsString::from_wide(&name[..len as usize])
                                .to_string_lossy()
                                .to_string(),
                        )
                    } else {
                        None
                    }
                } else {
                    None
                };

                if let Some(n) = name_opt2 {
                    n
                } else {
                    // 方法三：QueryFullProcessImageNameW，只需低权限，返回完整路径取文件名
                    get_process_name_by_image(pid).unwrap_or_else(|| {
                        // 方法四：从窗口标题最后一段推断（如 "文件名 - 应用名" 取最后段）
                        // 避免进程全部落入 Unknown 导致时长无法区分统计
                        if let Some(name_from_path) = executable_path.as_deref().and_then(|path| {
                            std::path::Path::new(path)
                                .file_name()
                                .and_then(|name| name.to_str())
                                .map(|name| name.to_string())
                        }) {
                            name_from_path
                        } else if !window_title.is_empty() {
                            window_title
                                .split(" - ")
                                .last()
                                .map(|s| s.trim().to_string())
                                .filter(|s| !s.is_empty() && s.len() < 40)
                                .unwrap_or_else(|| "Unknown".to_string())
                        } else {
                            "Unknown".to_string()
                        }
                    })
                }
            }
        } else {
            "Unknown".to_string()
        };

        let app_name = normalize_display_app_name(&raw_app_name);
        let is_minimized = IsIconic(hwnd) != 0;

        // 尝试获取浏览器 URL (Windows)，使用原始标题
        let browser_url = if include_browser_url {
            get_browser_url_windows(&raw_app_name, &window_title, hwnd as isize)
        } else {
            None
        };

        let window_title = clean_browser_window_title(&window_title, &app_name);

        let window_bounds = {
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            if GetWindowRect(hwnd, &mut rect) != 0 {
                let width = (rect.right - rect.left).max(0) as u32;
                let height = (rect.bottom - rect.top).max(0) as u32;
                if width > 0 && height > 0 {
                    Some(WindowBounds {
                        x: rect.left,
                        y: rect.top,
                        width,
                        height,
                    })
                } else {
                    None
                }
            } else {
                None
            }
        };

        Ok(ActiveWindow {
            app_name,
            window_title,
            browser_url,
            executable_path,
            window_bounds,
            is_minimized,
        })
    }
}

/// 通过 QueryFullProcessImageNameW 获取进程可执行文件完整路径，仅需低权限
#[cfg(target_os = "windows")]
fn get_process_image_path(pid: u32) -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::winbase::QueryFullProcessImageNameW;

    unsafe {
        // 只需 PROCESS_QUERY_LIMITED_INFORMATION，对 UAC 保护进程也有效
        let handle = OpenProcess(0x1000, 0, pid);
        if handle.is_null() {
            return None;
        }

        let mut buf: [u16; 512] = [0; 512];
        let mut size: u32 = 512;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
        CloseHandle(handle);

        if ok == 0 || size == 0 {
            return None;
        }

        normalize_executable_path(
            &OsString::from_wide(&buf[..size as usize])
                .to_string_lossy()
                .to_string(),
        )
    }
}

/// 通过 QueryFullProcessImageNameW 获取进程可执行文件名，仅需低权限
/// 返回 exe 文件名（不含路径，如 "WINWORD.EXE"），作为 GetModuleBaseNameW 的备用
#[cfg(target_os = "windows")]
fn get_process_name_by_image(pid: u32) -> Option<String> {
    get_process_image_path(pid).and_then(|full_path| {
        full_path
            .split('\\')
            .last()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    })
}

#[cfg(target_os = "windows")]
fn normalize_executable_path(path: &str) -> Option<String> {
    let trimmed = path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.replace('/', "\\"))
}

/// 从窗口获取浏览器 URL (Windows)
/// 使用原生 UI Automation COM 接口（通过 uiautomation crate），不再 spawn PowerShell 进程
/// 为避免串号，不缓存正向结果，优先保证 URL 与时长归属的准确性
#[cfg(target_os = "windows")]
fn get_browser_url_windows(app_name: &str, window_title: &str, hwnd: isize) -> Option<String> {
    if !is_browser_app(app_name) {
        return None;
    }

    // 使用原生 UI Automation 获取 URL，catch_unwind 防止 COM 异常导致崩溃
    let native_result = std::panic::catch_unwind(|| get_url_via_uiautomation(hwnd)).unwrap_or(None);
    if let Some(url) = native_result {
        log::debug!("浏览器 URL 命中原生 UIA: {url}");
        return Some(url);
    }

    let powershell_result = get_url_via_powershell_uia(hwnd);
    if let Some(url) = powershell_result {
        log::debug!("浏览器 URL 命中 PowerShell UIA: {url}");
        return Some(url);
    }

    // UI Automation 失败时，尝试从窗口标题提取域名信息作为兜底
    let title_result = infer_browser_page_hint(window_title);
    if title_result.is_none() {
        log::debug!(
            "浏览器 URL 获取失败: app={}, title={}",
            app_name,
            window_title
        );
    }
    title_result
}

/// Windows PowerShell 5.1 + UIAutomation 兜底读取真实地址栏 URL
/// 仅在原生 UIAutomation 失败时调用，避免常态化子进程开销。
#[cfg(target_os = "windows")]
fn get_url_via_powershell_uia(hwnd: isize) -> Option<String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const POWERSHELL_PATH: &str = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";

    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$hwnd = [IntPtr]::new({hwnd})
if ($hwnd -eq [IntPtr]::Zero) {{ exit 0 }}

$window = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $window) {{ exit 0 }}

$editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
)
$docCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document
)
$allConditions = New-Object System.Windows.Automation.OrCondition($editCondition, $docCondition)
$nodes = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $allConditions)

for ($i = 0; $i -lt $nodes.Count; $i++) {{
    $node = $nodes.Item($i)
    $candidates = New-Object System.Collections.Generic.List[string]

    try {{
        $vp = $node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($vp -ne $null -and $vp.Current.Value) {{ [void]$candidates.Add($vp.Current.Value) }}
    }} catch {{ }}

    try {{
        $lp = $node.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
        if ($lp -ne $null -and $lp.Current.Value) {{ [void]$candidates.Add($lp.Current.Value) }}
    }} catch {{ }}

    try {{
        if ($node.Current.Name) {{ [void]$candidates.Add($node.Current.Name) }}
    }} catch {{ }}

    foreach ($raw in $candidates) {{
        if ([string]::IsNullOrWhiteSpace($raw)) {{ continue }}
        $value = $raw.Trim()
        if ($value -match '^(https?://|chrome://|edge://|about:|file:)' -or
            $value -match '^(localhost|([a-zA-Z0-9-]+\.)+[a-zA-Z]{{2,}}|\d{{1,3}}(\.\d{{1,3}}){{3}})(:\d{{2,5}})?([/?#].*)?$') {{
            Write-Output $value
            exit 0
        }}
    }}
}}
"#
    );

    let output = run_monitor_command_with_timeout(
        Command::new(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Sta",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW),
        "Windows PowerShell URL 采集",
    )
    .ok()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.trim().is_empty() {
            log::debug!("PowerShell URL 采集失败: {}", stderr.trim());
        }
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    normalize_possible_url(&value)
}

/// 通过原生 UI Automation COM 接口获取浏览器地址栏 URL
/// 使用 HWND 精准定位浏览器窗口，查找 Edit 控件并读取 ValuePattern
#[cfg(target_os = "windows")]
fn get_url_via_uiautomation(hwnd: isize) -> Option<String> {
    use uiautomation::patterns::{UILegacyIAccessiblePattern, UIValuePattern};
    use uiautomation::types::{ControlType, Handle};
    use uiautomation::UIAutomation;

    let automation = UIAutomation::new().ok()?;
    // Handle 内部字段在 0.24.4 变为私有，改用 From trait 构造
    let window_element = automation.element_from_handle(Handle::from(hwnd)).ok()?;

    let mut best_match: Option<(i32, String)> = None;

    let inspect_control = |control: uiautomation::UIElement,
                           best_match: &mut Option<(i32, String)>| {
        let control_type = match control.get_control_type() {
            Ok(t) => t,
            Err(_) => return,
        };

        if control_type != ControlType::Edit && control_type != ControlType::Document {
            return;
        }

        let name = control.get_name().unwrap_or_default();
        let class_name = control.get_classname().unwrap_or_default();
        let name_lower = name.to_lowercase();
        let class_lower = class_name.to_lowercase();
        let address_like = name_lower.contains("address")
            || name_lower.contains("地址")
            || name_lower.contains("location")
            || name_lower.contains("omnibox")
            || class_lower.contains("omnibox")
            || class_lower.contains("address");

        let mut candidates = Vec::new();
        if let Ok(pattern) = control.get_pattern::<UIValuePattern>() {
            if let Ok(value) = pattern.get_value() {
                candidates.push(value);
            }
        }
        if let Ok(pattern) = control.get_pattern::<UILegacyIAccessiblePattern>() {
            if let Ok(value) = pattern.get_value() {
                candidates.push(value);
            }
        }
        candidates.push(name.clone());

        for raw in candidates {
            let Some(url) = normalize_possible_url(&raw) else {
                continue;
            };

            let mut score = match control_type {
                ControlType::Edit => 35,
                ControlType::Document => 15,
                _ => 0,
            };

            if address_like {
                score += 50;
            }
            if raw.starts_with("http://") || raw.starts_with("https://") {
                score += 30;
            } else if raw == class_name || raw == name {
                score += 5;
            }

            if score >= 60
                && best_match
                    .as_ref()
                    .map(|(best_score, _)| score > *best_score)
                    .unwrap_or(true)
            {
                *best_match = Some((score, url));
            }
        }
    };

    // 先扫描全部 Edit 控件。
    // Chrome/Chromium 的地址栏在不同版本和 UI 状态下不一定是第一个 Edit；
    // 只取 find_first 很容易误拿到页面内搜索框，导致 URL 统计长期为空。
    if let Ok(edits) = automation
        .create_matcher()
        .from(window_element.clone())
        .control_type(ControlType::Edit)
        .timeout(300)
        .find_all()
    {
        for edit in edits {
            inspect_control(edit, &mut best_match);
        }
    }
    if let Some((score, url)) = &best_match {
        if *score >= 85 {
            return Some(url.clone());
        }
    }

    // 再扫 Document 控件作为补充。
    // 某些浏览器或特殊页面会把可读 URL 暴露在 Document，而不是地址栏 Edit。
    if let Ok(docs) = automation
        .create_matcher()
        .from(window_element)
        .control_type(ControlType::Document)
        .timeout(300)
        .find_all()
    {
        for doc in docs {
            inspect_control(doc, &mut best_match);
        }
    }

    best_match.map(|(_, url)| url)
}

/// 从窗口标题尝试提取 URL 或域名（UI Automation 失败时的兜底方案）
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn extract_url_from_title(window_title: &str) -> Option<String> {
    let title = window_title.trim();
    if title.is_empty() {
        return None;
    }

    // 标题本身就是 URL
    if let Some(url) = title
        .split_whitespace()
        .next()
        .and_then(normalize_possible_url)
    {
        return Some(url);
    }

    // 尝试从 "Page Title - domain.com - Browser" 格式中提取域名
    for part in title.rsplit(" - ") {
        if let Some(url) = normalize_possible_url(part) {
            return Some(url);
        }
    }

    extract_url_from_text(title)
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::{
        best_browser_url_candidate_from_output, browser_url_script_macos,
        browser_url_system_events_process_name_macos, browser_url_ui_script_macos,
    };
    use super::{
        categorize_app, categorize_app_with_rules, clean_browser_window_title, decode_mozlz4_bytes,
        extract_active_tab_url_from_session_store_value, extract_url_from_title,
        firefox_family_profile_dir_from_ini, is_browser_app, is_probable_domain,
        normalize_display_app_name, normalize_macos_frontmost_app_name, normalize_possible_url,
        remember_browser_url_log, semantic_category_to_base_category,
    };
    use std::collections::HashMap;
    use std::path::Path;
    #[cfg(target_os = "macos")]
    use std::{
        fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn 识别浏览器进程名() {
        assert!(is_browser_app("chrome.exe"));
        assert!(is_browser_app("msedge.exe"));
        assert!(is_browser_app("Microsoft Edge"));
        assert!(is_browser_app("QQ Browser"));
        assert!(is_browser_app("360 Browser"));
        assert!(is_browser_app("Sogou Browser"));
        assert!(is_browser_app("Safari"));
        assert!(!is_browser_app("Code.exe"));
    }

    #[test]
    fn 浏览器识别不应被tencent等子串误中() {
        // 回归测试：之前 contains("cent") 把 "Tencent Lemon" 等所有腾讯系应用都误判为浏览器，
        // 导致它们出现在日报"网站访问明细"里。
        assert!(!is_browser_app("Tencent Lemon"));
        assert!(!is_browser_app("Tencent Meeting"));
        assert!(!is_browser_app("WeChat")); // 与 cent 无关，但同属腾讯系
                                            // arc 也类似（之前 contains("arc") 会误中 "Arch Linux"、"Search" 等）
        assert!(!is_browser_app("Arch Linux"));
        assert!(!is_browser_app("Spotlight Search"));
        // 真正的 Cent / Arc 浏览器仍然识别得到
        assert!(is_browser_app("Cent"));
        assert!(is_browser_app("Cent Browser"));
        assert!(is_browser_app("Arc"));
    }

    #[test]
    fn 归一化后的浏览器显示名仍能归类为浏览器() {
        assert_eq!(categorize_app("Microsoft Edge", "example.com"), "browser");
        assert_eq!(categorize_app("QQ Browser", "example.com"), "browser");
        assert_eq!(categorize_app("360 Browser", "example.com"), "browser");
        assert_eq!(categorize_app("Sogou Browser", "example.com"), "browser");
    }

    #[test]
    fn 手动分类规则应优先于内置分类() {
        let rules = vec![crate::config::AppCategoryRule {
            app_name: "MuMu".to_string(),
            category: "entertainment".to_string(),
        }];

        assert_eq!(
            categorize_app_with_rules(&rules, "MuMu模拟器", "项目设计稿", &[]),
            "entertainment"
        );
        assert_eq!(categorize_app("MuMu模拟器", "项目设计稿"), "other");
    }

    #[test]
    fn 手动分类规则匹配应兼容应用名归一化() {
        let rules = vec![crate::config::AppCategoryRule {
            app_name: "Firefox".to_string(),
            category: "office".to_string(),
        }];

        assert_eq!(
            categorize_app_with_rules(&rules, "firefox", "搜索页", &[]),
            "office"
        );
    }

    #[test]
    fn 网站语义分类应映射为可统计的基础分类() {
        assert_eq!(
            semantic_category_to_base_category("休息娱乐", "browser"),
            "entertainment"
        );
        assert_eq!(
            semantic_category_to_base_category("编码开发", "browser"),
            "development"
        );
        assert_eq!(
            semantic_category_to_base_category("资料阅读", "browser"),
            "browser"
        );
        assert_eq!(
            semantic_category_to_base_category("未知自定义语义", "browser"),
            "browser"
        );
    }

    #[test]
    fn 常见系统与桌面应用名应归一化为稳定显示名() {
        assert_eq!(normalize_display_app_name("discover"), "Discover");
        assert_eq!(normalize_display_app_name("mail"), "Mail");
        assert_eq!(normalize_display_app_name("邮件"), "Mail");
        assert_eq!(
            normalize_display_app_name("coreautha"),
            "System Authentication"
        );
        assert_eq!(
            normalize_display_app_name("Work_Review.v1.0.35_x64-setup"),
            "Work Review Setup"
        );
        assert_eq!(normalize_display_app_name("xfltd"), "XFLTD");
    }

    #[test]
    fn 规范化地址栏候选值() {
        assert_eq!(
            normalize_possible_url("https://example.com/path"),
            Some("https://example.com/path".to_string())
        );
        assert_eq!(
            normalize_possible_url("example.com"),
            Some("https://example.com".to_string())
        );
        assert_eq!(
            normalize_possible_url("bing.com/search?q=test"),
            Some("https://bing.com/search?q=test".to_string())
        );
        assert_eq!(
            normalize_possible_url("localhost:3000/dashboard"),
            Some("http://localhost:3000/dashboard".to_string())
        );
        assert_eq!(
            normalize_possible_url("chrome://settings"),
            Some("chrome://settings".to_string())
        );
        assert_eq!(normalize_possible_url("搜索内容"), None);
        assert_eq!(normalize_possible_url("1.2.3"), None);
    }

    #[test]
    fn 从标题提取域名时避免误判() {
        assert_eq!(
            extract_url_from_title("项目文档 - docs.example.com - Google Chrome"),
            Some("https://docs.example.com".to_string())
        );
        assert_eq!(
            extract_url_from_title("bing.com/search?q=test - Google Chrome"),
            Some("https://bing.com/search?q=test".to_string())
        );
        assert_eq!(extract_url_from_title("版本 1.2.3 - Google Chrome"), None);
        assert!(is_probable_domain("sub.example.com"));
        assert!(!is_probable_domain("1.2.3"));
    }

    #[test]
    fn 通用_electron_进程名应优先使用应用路径还原真实名称() {
        assert_eq!(
            normalize_macos_frontmost_app_name(
                "Electron",
                "欢迎使用",
                Some("com.trae.app"),
                Some("/Applications/Trae.app"),
            ),
            "Trae"
        );
        assert_eq!(
            normalize_macos_frontmost_app_name(
                "Electron Helper",
                "",
                Some("com.trae.cn"),
                Some("/Applications/Trae CN.app"),
            ),
            "Trae CN"
        );
    }

    #[test]
    fn 通用_electron_进程名应在缺少路径时回退到_bundle_id() {
        assert_eq!(
            normalize_macos_frontmost_app_name(
                "Electron",
                "",
                Some("com.bytedance.doubao.browser"),
                None,
            ),
            "Doubao Browser"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn zen_浏览器应走_system_events_兜底() {
        assert_eq!(
            browser_url_system_events_process_name_macos("zen browser"),
            Some("Zen")
        );
        let script = browser_url_ui_script_macos("Zen");
        assert!(script.contains(r#"tell process "Zen""#));
        assert!(script.contains("AXTextField"));
        assert!(script.contains("toolbar 1 of frontWin"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn zen_ui_采集脚本应能通过编译() {
        let script = browser_url_ui_script_macos("Zen");
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间应晚于 UNIX_EPOCH")
            .as_nanos();
        let temporary = work_review_core::config::temporary_directory();
        std::fs::create_dir_all(&temporary).unwrap();
        let compiled_path = temporary.join(format!("zen-url-ui-{unique}.scpt"));

        let output = Command::new("osacompile")
            .arg("-e")
            .arg(&script)
            .arg("-o")
            .arg(&compiled_path)
            .output()
            .expect("应能调用 osacompile");

        if compiled_path.exists() {
            let _ = fs::remove_file(&compiled_path);
        }

        assert!(
            output.status.success(),
            "脚本编译失败: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn 直接_applescript_浏览器脚本应先检查应用是否仍在运行() {
        let cases = [
            ("google chrome", "Google Chrome"),
            ("safari", "Safari"),
            ("edge", "Microsoft Edge"),
            ("arc", "Arc"),
            ("brave", "Brave Browser"),
            ("opera", "Opera"),
            ("vivaldi", "Vivaldi"),
            ("chromium", "Chromium"),
            ("orion", "Orion"),
            ("sidekick", "Sidekick"),
        ];

        for (app_lower, app_name) in cases {
            let (script, _) = browser_url_script_macos(app_lower).expect("应返回浏览器脚本");
            assert!(
                script.contains(&format!(r#"if application "{app_name}" is running then"#)),
                "{app_name} 脚本缺少运行态守卫"
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn 浏览器_url候选应优先完整路径() {
        let output = r#"
https://www.google.com.hk
www.google.com.hk
https://www.google.com.hk/search?q=张凌赫
"#;

        assert_eq!(
            best_browser_url_candidate_from_output(output),
            Some("https://www.google.com.hk/search?q=张凌赫".to_string())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn 浏览器_url候选应优先地址栏值字段() {
        let output = r#"
title	https://linux.dofttopic
name	https://linux.dofttopic
value	https://linux.do/latest
"#;

        assert_eq!(
            best_browser_url_candidate_from_output(output),
            Some("https://linux.do/latest".to_string())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn 可疑的_host_only_浏览器候选应被忽略() {
        let output = r#"
title	https://linux.dofttopic
name	https://linux.dofttopic
"#;

        assert_eq!(best_browser_url_candidate_from_output(output), None);
    }

    #[test]
    fn 应从_profiles_ini_解析默认_profile目录() {
        let ini = r#"
[Install6ED35B3CA1B5D3AF]
Default=Profiles/wkm9x2lf.Default (release)
Locked=1

[Profile1]
Name=Default Profile
IsRelative=1
Path=Profiles/rb6yc5s2.Default Profile
Default=1

[Profile0]
Name=Default (release)
IsRelative=1
Path=Profiles/wkm9x2lf.Default (release)
"#;

        let profile_dir = firefox_family_profile_dir_from_ini(Path::new("/tmp/Zen"), ini)
            .expect("应解析出默认 profile");

        assert_eq!(
            profile_dir,
            Path::new("/tmp/Zen/Profiles/wkm9x2lf.Default (release)")
        );
    }

    #[test]
    fn mozlz4_字面量块应能解码() {
        let data = [
            b'm', b'o', b'z', b'L', b'z', b'4', b'0', 0, 5, 0, 0, 0, 0x50, b'h', b'e', b'l', b'l',
            b'o',
        ];

        let decoded = decode_mozlz4_bytes(&data).expect("应成功解码");
        assert_eq!(decoded, b"hello");
    }

    #[test]
    fn mozlz4_匹配块应能解码() {
        let data = [
            b'm', b'o', b'z', b'L', b'z', b'4', b'0', 0, 9, 0, 0, 0, 0x32, b'a', b'b', b'c', 0x03,
            0x00,
        ];

        let decoded = decode_mozlz4_bytes(&data).expect("应成功解码");
        assert_eq!(decoded, b"abcabcabc");
    }

    #[test]
    fn 应从_sessionstore_提取当前激活标签页_url() {
        let value = serde_json::json!({
            "selectedWindow": 1,
            "windows": [
                {
                    "selected": 2,
                    "tabs": [
                        {
                            "index": 1,
                            "entries": [
                                {"url": "https://example.com/older", "title": "旧页面"}
                            ]
                        },
                        {
                            "index": 2,
                            "entries": [
                                {"url": "https://example.com/step-1", "title": "步骤 1"},
                                {"url": "https://example.com/final?q=1", "title": "最终页面"}
                            ]
                        }
                    ]
                }
            ]
        });

        assert_eq!(
            extract_active_tab_url_from_session_store_value(&value, ""),
            Some("https://example.com/final?q=1".to_string())
        );
    }

    #[test]
    fn sessionstore_selected滞后时应优先窗口标题匹配的标签页() {
        let value = serde_json::json!({
            "selectedWindow": 1,
            "windows": [
                {
                    "selected": 1,
                    "tabs": [
                        {
                            "index": 1,
                            "lastAccessed": 10,
                            "entries": [
                                {"url": "about:newtab", "title": "Mozilla Firefox"}
                            ]
                        },
                        {
                            "index": 1,
                            "lastAccessed": 20,
                            "entries": [
                                {
                                    "url": "https://www.google.com/search?q=test",
                                    "title": "定的计划 - Google 搜索"
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        assert_eq!(
            extract_active_tab_url_from_session_store_value(&value, "定的计划 - Google 搜索"),
            Some("https://www.google.com/search?q=test".to_string())
        );
    }

    #[test]
    fn 相同浏览器_url日志应去重() {
        let mut cache = HashMap::new();

        assert!(remember_browser_url_log(
            &mut cache,
            "sessionstore:firefox",
            "https://example.com/a"
        ));
        assert!(!remember_browser_url_log(
            &mut cache,
            "sessionstore:firefox",
            "https://example.com/a"
        ));
        assert!(remember_browser_url_log(
            &mut cache,
            "sessionstore:firefox",
            "https://example.com/b"
        ));
    }

    #[test]
    fn 浏览器标题应清理内存警告信息() {
        assert_eq!(
            clean_browser_window_title(
                "文档查看 - 内存用量高 - 841 MB - Google Chrome - momoi (行走的卫星)",
                "Google Chrome"
            ),
            "文档查看 - momoi (行走的卫星)"
        );
    }

    #[test]
    fn 浏览器标题应保留纯页面标题() {
        assert_eq!(
            clean_browser_window_title("GitHub - mozilla/rust: Rust", "Google Chrome"),
            "GitHub - mozilla/rust: Rust"
        );
    }

    #[test]
    fn 非浏览器标题不做清理() {
        assert_eq!(
            clean_browser_window_title("main.rs - My Project - Visual Studio Code", "Code"),
            "main.rs - My Project - Visual Studio Code"
        );
    }
}

#[cfg(target_os = "macos")]
pub fn get_active_window() -> Result<ActiveWindow> {
    get_active_window_with_options(true)
}

#[cfg(target_os = "macos")]
pub fn get_active_window_fast() -> Result<ActiveWindow> {
    get_active_window_with_options(false)
}

#[cfg(target_os = "macos")]
fn get_active_window_with_options(include_browser_url: bool) -> Result<ActiveWindow> {
    let native = crate::macos_window::frontmost_window()?;
    let app_name = normalize_macos_frontmost_app_name(
        &native.app_name,
        &native.title,
        Some(&native.bundle_identifier),
        Some(&native.app_path),
    );
    let window_bounds = native
        .bounds
        .or_else(|| find_frontmost_window_bounds(&native.app_name, &native.title));
    let window_title = clean_browser_window_title(&native.title, &app_name);
    let browser_url = if include_browser_url {
        get_browser_url(&app_name, &native.title)
    } else {
        None
    };
    Ok(ActiveWindow {
        app_name,
        window_title,
        browser_url,
        executable_path: (!native.app_path.is_empty()).then_some(native.app_path),
        window_bounds,
        is_minimized: false,
    })
}

#[cfg(target_os = "macos")]
fn find_frontmost_window_bounds(owner_name: &str, window_title: &str) -> Option<WindowBounds> {
    use core_foundation::array::{CFArrayGetCount, CFArrayGetValueAtIndex};
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::dictionary::CFDictionaryRef;
    use core_foundation::number::CFNumberRef;
    use core_foundation::string::CFString;
    use core_graphics::display::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        CGWindowListCopyWindowInfo,
    };

    let owner_name = owner_name.trim();
    if owner_name.is_empty() {
        return None;
    }

    let target_owner = owner_name.to_lowercase();
    let target_title = window_title.trim();

    unsafe {
        let window_list = CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        );
        if window_list.is_null() {
            return None;
        }

        let count = CFArrayGetCount(window_list as _);
        let mut fallback_match: Option<WindowBounds> = None;

        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(window_list as _, i) as CFDictionaryRef;
            if dict.is_null() {
                continue;
            }

            let owner_key = CFString::new("kCGWindowOwnerName");
            let mut owner_ref: CFTypeRef = std::ptr::null();
            if core_foundation::dictionary::CFDictionaryGetValueIfPresent(
                dict,
                owner_key.as_CFTypeRef() as *const _,
                &mut owner_ref,
            ) == 0
                || owner_ref.is_null()
            {
                continue;
            }

            let owner_cfstr =
                core_foundation::string::CFString::wrap_under_get_rule(owner_ref as _);
            let candidate_owner = owner_cfstr.to_string();
            if candidate_owner.trim().to_lowercase() != target_owner {
                continue;
            }

            let layer_key = CFString::new("kCGWindowLayer");
            let mut layer_ref: CFTypeRef = std::ptr::null();
            if core_foundation::dictionary::CFDictionaryGetValueIfPresent(
                dict,
                layer_key.as_CFTypeRef() as *const _,
                &mut layer_ref,
            ) == 0
                || layer_ref.is_null()
            {
                continue;
            }

            let mut layer: i32 = 0;
            if !core_foundation::number::CFNumberGetValue(
                layer_ref as CFNumberRef,
                core_foundation::number::kCFNumberSInt32Type,
                &mut layer as *mut i32 as *mut _,
            ) || layer != 0
            {
                continue;
            }

            let bounds_key = CFString::new("kCGWindowBounds");
            let mut bounds_ref: CFTypeRef = std::ptr::null();
            if core_foundation::dictionary::CFDictionaryGetValueIfPresent(
                dict,
                bounds_key.as_CFTypeRef() as *const _,
                &mut bounds_ref,
            ) == 0
                || bounds_ref.is_null()
            {
                continue;
            }

            let bounds_dict = bounds_ref as CFDictionaryRef;
            let x = get_cf_dict_number(bounds_dict, "X").unwrap_or(0.0) as i32;
            let y = get_cf_dict_number(bounds_dict, "Y").unwrap_or(0.0) as i32;
            let width = get_cf_dict_number(bounds_dict, "Width")
                .unwrap_or(0.0)
                .max(0.0) as u32;
            let height = get_cf_dict_number(bounds_dict, "Height")
                .unwrap_or(0.0)
                .max(0.0) as u32;
            if width == 0 || height == 0 {
                continue;
            }

            let candidate_bounds = WindowBounds {
                x,
                y,
                width,
                height,
            };

            let name_key = CFString::new("kCGWindowName");
            let mut name_ref: CFTypeRef = std::ptr::null();
            let candidate_title = if core_foundation::dictionary::CFDictionaryGetValueIfPresent(
                dict,
                name_key.as_CFTypeRef() as *const _,
                &mut name_ref,
            ) != 0
                && !name_ref.is_null()
            {
                let name_cfstr =
                    core_foundation::string::CFString::wrap_under_get_rule(name_ref as _);
                name_cfstr.to_string()
            } else {
                String::new()
            };

            if !target_title.is_empty() && candidate_title.trim() == target_title {
                CFRelease(window_list as _);
                return Some(candidate_bounds);
            }

            fallback_match.get_or_insert(candidate_bounds);
        }

        CFRelease(window_list as _);
        fallback_match
    }
}

/// 规范化 Electron 应用名称
/// 对于一些基于 Electron 的应用，进程名可能是 Electron 或 xxxx Helper
/// 需要根据窗口标题或其他特征识别真实应用名
#[cfg(any(target_os = "macos", test))]
fn normalize_electron_app_name(process_name: &str, window_title: &str) -> String {
    let process_lower = process_name.to_lowercase();
    let title_lower = window_title.to_lowercase();

    let process_aliases = [
        ("work-review", "Work Review"),
        ("work_review", "Work Review"),
        ("workreview", "Work Review"),
    ];

    for (pattern, real_name) in process_aliases.iter() {
        if process_lower == *pattern {
            log::debug!("进程名归一化: {process_name} -> {real_name}");
            return real_name.to_string();
        }
    }

    // 优先检查窗口标题是否包含浏览器名称
    // 这对于 Chrome 等浏览器至关重要，因为它们可能被误识别为 Electron
    let browser_patterns = [
        ("google chrome", "Google Chrome"),
        ("chrome", "Google Chrome"),
        ("safari", "Safari"),
        ("firefox", "Firefox"),
        ("microsoft edge", "Microsoft Edge"),
        ("edge", "Microsoft Edge"),
        ("arc", "Arc"),
        ("brave", "Brave Browser"),
        ("opera", "Opera"),
        ("vivaldi", "Vivaldi"),
        ("chromium", "Chromium"),
        ("orion", "Orion"),
        ("zen browser", "Zen Browser"),
        ("sidekick", "Sidekick"),
    ];

    for (pattern, browser_name) in browser_patterns.iter() {
        if title_lower.contains(pattern) {
            log::debug!(
                "浏览器识别: {process_name} -> {browser_name} (基于窗口标题: {window_title})"
            );
            return browser_name.to_string();
        }
    }

    // 如果不是 Electron 相关进程，直接返回
    if !process_lower.contains("electron") && !process_lower.contains("helper") {
        return process_name.to_string();
    }

    // Electron 应用映射表：通过窗口标题关键词识别
    let electron_apps = [
        // 编辑器/IDE
        ("cursor", "Cursor"),
        ("visual studio code", "VS Code"),
        ("vscode", "VS Code"),
        ("code - ", "VS Code"), // VS Code 窗口标题常见格式
        // AI 工具
        ("antigravity", "Antigravity"),
        ("work review", "Work Review"),
        ("copilot", "GitHub Copilot"),
        ("claude", "Claude Desktop"),
        // 通讯工具
        ("slack", "Slack"),
        ("discord", "Discord"),
        ("teams", "Microsoft Teams"),
        ("telegram", "Telegram Desktop"),
        ("whatsapp", "WhatsApp"),
        // 笔记/知识管理
        ("notion", "Notion"),
        ("obsidian", "Obsidian"),
        ("logseq", "Logseq"),
        ("roam", "Roam Research"),
        ("craft", "Craft"),
        // 其他开发工具
        ("postman", "Postman"),
        ("insomnia", "Insomnia"),
        ("figma", "Figma"),
        ("1password", "1Password"),
        ("bitwarden", "Bitwarden"),
        // 其他常见应用
        ("spotify", "Spotify"),
        ("todoist", "Todoist"),
        ("linear", "Linear"),
        ("raycast", "Raycast"),
    ];

    // 遍历映射表查找匹配
    for (keyword, real_name) in electron_apps.iter() {
        if title_lower.contains(keyword) {
            log::debug!(
                "Electron 应用识别: {process_name} -> {real_name} (基于窗口标题: {window_title})"
            );
            return real_name.to_string();
        }
    }

    // 如果窗口标题有明确的应用名格式（如 "AppName - Document"）
    // 尝试提取第一个部分作为应用名
    if let Some(first_part) = window_title.split(" - ").last() {
        let trimmed = first_part.trim();
        if !trimmed.is_empty() && trimmed.len() < 30 && !trimmed.contains('/') {
            // 检查是否像是应用名（首字母大写或全英文）
            if trimmed
                .chars()
                .next()
                .map(|c| c.is_uppercase())
                .unwrap_or(false)
                || trimmed
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c.is_whitespace())
            {
                log::debug!("Electron 应用推断: {process_name} -> {trimmed} (从标题提取)");
                return trimmed.to_string();
            }
        }
    }

    // 无法识别，返回原始进程名
    log::debug!("无法识别 Electron 应用: {process_name} (标题: {window_title})");
    process_name.to_string()
}

#[cfg(any(target_os = "macos", test))]
fn is_generic_frontmost_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_lowercase();
    normalized.contains("electron")
        || normalized == "helper"
        || normalized.ends_with(" helper")
        || normalized.contains(" helper (")
}

#[cfg(any(target_os = "macos", test))]
fn trim_macos_helper_suffix(name: &str) -> String {
    let trimmed = name.trim();
    let lower = trimmed.to_lowercase();

    if let Some(index) = lower.find(" helper (") {
        return trimmed[..index].trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_suffix(" Helper") {
        return stripped.trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_suffix(" helper") {
        return stripped.trim().to_string();
    }

    trimmed.to_string()
}

#[cfg(any(target_os = "macos", test))]
fn is_generic_app_display_name(name: &str) -> bool {
    let normalized = trim_macos_helper_suffix(name).trim().to_lowercase();
    normalized.is_empty()
        || normalized == "electron"
        || normalized == "helper"
        || normalized == "application"
}

#[cfg(any(target_os = "macos", test))]
fn display_name_from_macos_app_path(app_path: &str) -> Option<String> {
    let path = Path::new(app_path);
    let bundle_name = path
        .ancestors()
        .filter(|ancestor| {
            ancestor
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("app"))
                .unwrap_or(false)
        })
        .filter_map(|ancestor| ancestor.file_stem().and_then(|name| name.to_str()))
        .last()?;
    let candidate = trim_macos_helper_suffix(bundle_name);
    if is_generic_app_display_name(&candidate) {
        None
    } else {
        Some(candidate)
    }
}

#[cfg(any(target_os = "macos", test))]
fn humanize_bundle_identifier_token(token: &str) -> Option<String> {
    let trimmed = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_lowercase();
    let rendered = if lower.len() <= 3 && lower.chars().all(|ch| ch.is_ascii_alphabetic()) {
        lower.to_uppercase()
    } else {
        let mut chars = lower.chars();
        let first = chars.next()?;
        let mut value = String::new();
        value.extend(first.to_uppercase());
        value.push_str(chars.as_str());
        value
    };

    Some(rendered)
}

#[cfg(any(target_os = "macos", test))]
fn display_name_from_bundle_identifier(bundle_identifier: &str) -> Option<String> {
    let generic_segments = ["com", "cn", "net", "org", "io", "app", "desktop", "helper"];

    let segments = bundle_identifier
        .split('.')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return None;
    }

    let start = segments
        .iter()
        .position(|segment| !generic_segments.contains(&segment.to_ascii_lowercase().as_str()))
        .unwrap_or(segments.len());
    if start >= segments.len() {
        return None;
    }

    let mut tail = segments[start..].to_vec();
    if tail.len() >= 3 {
        tail.remove(0);
    }
    while tail.len() > 1 {
        let Some(last) = tail.last() else {
            break;
        };
        let lower = last.to_ascii_lowercase();
        if matches!(lower.as_str(), "app" | "desktop" | "helper") {
            tail.pop();
        } else {
            break;
        }
    }

    let candidate = tail
        .into_iter()
        .filter_map(humanize_bundle_identifier_token)
        .collect::<Vec<_>>()
        .join(" ");
    if is_generic_app_display_name(&candidate) {
        None
    } else {
        Some(candidate)
    }
}

#[cfg(any(target_os = "macos", test))]
fn normalize_macos_frontmost_app_name(
    process_name: &str,
    window_title: &str,
    bundle_identifier: Option<&str>,
    app_path: Option<&str>,
) -> String {
    let legacy_name = normalize_electron_app_name(process_name, window_title);

    if !is_generic_frontmost_process_name(process_name) {
        return normalize_display_app_name(&legacy_name);
    }

    if let Some(candidate) = app_path
        .and_then(display_name_from_macos_app_path)
        .or_else(|| bundle_identifier.and_then(display_name_from_bundle_identifier))
    {
        let normalized = normalize_display_app_name(&candidate);
        log::debug!(
            "macOS 前台应用识别: {process_name} -> {normalized} (bundle={:?}, path={:?})",
            bundle_identifier,
            app_path
        );
        return normalized;
    }

    normalize_display_app_name(&legacy_name)
}

/// 获取浏览器当前 URL (macOS)
/// 使用 window 1 获取最前面窗口的活动标签页 URL
#[cfg(target_os = "macos")]
fn build_running_guarded_browser_script_macos(app_name: &str, inner: &str) -> String {
    format!(
        "if application \"{app_name}\" is running then\n    tell application \"{app_name}\"\n{inner}\n    end tell\nelse\n    return \"\"\nend if",
        app_name = app_name,
        inner = inner
    )
}

#[cfg(target_os = "macos")]
fn browser_url_script_macos(app_lower: &str) -> Option<(String, &'static str)> {
    if app_lower.contains("chrome") || app_lower.contains("google chrome") {
        // Chrome: 使用 front window 获取最近激活的窗口
        Some((
            build_running_guarded_browser_script_macos(
                "Google Chrome",
                r#"        if (count of windows) > 0 then
            return URL of active tab of front window
        else
            return ""
        end if"#,
            ),
            "Chrome",
        ))
    } else if app_lower.contains("safari") {
        Some((
            build_running_guarded_browser_script_macos(
                "Safari",
                r#"        if (count of windows) > 0 then
            return URL of current tab of front window
        else
            return ""
        end if"#,
            ),
            "Safari",
        ))
    } else if app_lower.contains("firefox") {
        // Firefox 对 AppleScript 支持有限，但仍保持未运行守卫避免意外拉起
        Some((
            build_running_guarded_browser_script_macos(
                "Firefox",
                r#"        return URL of front document"#,
            ),
            "Firefox",
        ))
    } else if app_lower.contains("edge") {
        Some((
            build_running_guarded_browser_script_macos(
                "Microsoft Edge",
                r#"        if (count of windows) > 0 then
            return URL of active tab of front window
        else
            return ""
        end if"#,
            ),
            "Edge",
        ))
    } else if app_lower.contains("arc") {
        Some((
            build_running_guarded_browser_script_macos(
                "Arc",
                r#"        if (count of windows) > 0 then
            return URL of active tab of front window
        else
            return ""
        end if"#,
            ),
            "Arc",
        ))
    } else if app_lower.contains("brave") {
        Some((
            build_running_guarded_browser_script_macos(
                "Brave Browser",
                r#"        if (count of windows) > 0 then
            return URL of active tab of front window
        else
            return ""
        end if"#,
            ),
            "Brave",
        ))
    } else if app_lower.contains("opera") {
        Some((
            build_running_guarded_browser_script_macos(
                "Opera",
                r#"        if (count of windows) > 0 then
            return URL of active tab of front window
        else
            return ""
        end if"#,
            ),
            "Opera",
        ))
    } else if app_lower.contains("vivaldi") {
        Some((
            build_running_guarded_browser_script_macos(
                "Vivaldi",
                r#"        if (count of windows) > 0 then
            return URL of active tab of front window
        else
            return ""
        end if"#,
            ),
            "Vivaldi",
        ))
    } else if app_lower.contains("chromium") {
        Some((
            build_running_guarded_browser_script_macos(
                "Chromium",
                r#"        if (count of windows) > 0 then
            return URL of active tab of front window
        else
            return ""
        end if"#,
            ),
            "Chromium",
        ))
    } else if app_lower.contains("orion") {
        Some((
            build_running_guarded_browser_script_macos(
                "Orion",
                r#"        if (count of documents) > 0 then
            return URL of front document
        else
            return ""
        end if"#,
            ),
            "Orion",
        ))
    } else if app_lower.contains("sidekick") {
        // Sidekick 基于 Chromium
        Some((
            build_running_guarded_browser_script_macos(
                "Sidekick",
                r#"        if (count of windows) > 0 then
            return URL of active tab of front window
        else
            return ""
        end if"#,
            ),
            "Sidekick",
        ))
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn browser_url_system_events_process_name_macos(app_lower: &str) -> Option<&'static str> {
    if app_lower.contains("firefox") {
        Some("Firefox")
    } else if app_lower.contains("zen") {
        Some("Zen")
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BrowserUrlCandidateSource {
    Value,
    Description,
    Title,
    Name,
    Unknown,
}

#[cfg(target_os = "macos")]
fn parse_browser_url_candidate_line(raw_line: &str) -> (BrowserUrlCandidateSource, &str) {
    let trimmed = raw_line.trim();

    if let Some((prefix, value)) = trimmed.split_once('\t') {
        let source = match prefix.trim() {
            "value" => BrowserUrlCandidateSource::Value,
            "description" => BrowserUrlCandidateSource::Description,
            "title" => BrowserUrlCandidateSource::Title,
            "name" => BrowserUrlCandidateSource::Name,
            _ => BrowserUrlCandidateSource::Unknown,
        };

        if source != BrowserUrlCandidateSource::Unknown {
            return (source, value.trim());
        }
    }

    (BrowserUrlCandidateSource::Unknown, trimmed)
}

#[cfg(target_os = "macos")]
fn browser_url_candidate_source_bonus(source: BrowserUrlCandidateSource) -> i32 {
    match source {
        BrowserUrlCandidateSource::Value => 80,
        BrowserUrlCandidateSource::Description => 35,
        BrowserUrlCandidateSource::Title => 10,
        BrowserUrlCandidateSource::Name => 5,
        BrowserUrlCandidateSource::Unknown => 0,
    }
}

#[cfg(target_os = "macos")]
fn http_url_host_and_rest(url: &str) -> Option<(&str, &str)> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    Some(split_host_and_rest(rest))
}

#[cfg(target_os = "macos")]
fn is_suspicious_host_only_browser_candidate(url: &str) -> bool {
    let Some((host, rest)) = http_url_host_and_rest(url) else {
        return false;
    };

    if !rest.is_empty() {
        return false;
    }

    let host = split_host_port(host).0.trim_end_matches('.');
    if host.is_empty() || host == "localhost" || is_probable_ipv4(host) {
        return false;
    }

    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() != 2 {
        return false;
    }

    let tld = labels[1].trim().to_lowercase();
    if tld.len() <= 6 || !tld.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }

    matches!(
        &tld[..2],
        "ai" | "cc"
            | "cn"
            | "de"
            | "do"
            | "fr"
            | "hk"
            | "id"
            | "in"
            | "io"
            | "jp"
            | "kr"
            | "me"
            | "ru"
            | "sg"
            | "tv"
            | "uk"
            | "us"
    )
}

#[cfg(target_os = "macos")]
fn browser_url_ui_script_macos(process_name: &str) -> String {
    format!(
        r#"set output to ""
tell application "System Events"
    tell process "{process_name}"
        if (count of windows) is 0 then return ""
        set frontWin to front window
        try
            set output to my collect_url_candidates(toolbar 1 of frontWin)
        end try
        if output is not "" then return output
        return my collect_url_candidates(frontWin)
    end tell
end tell

on collect_url_candidates(rootElem)
    using terms from application "System Events"
        tell application "System Events"
            set output to ""
            set allElems to {{}}
            try
                set allElems to entire contents of rootElem
            on error
                return ""
            end try

            repeat with elem in allElems
                try
                    set roleName to (role of elem) as text
                    if roleName is "AXTextField" or roleName is "AXTextArea" or roleName is "AXComboBox" then
                        try
                            set candidateValue to (value of elem) as text
                            if candidateValue is not "" then set output to output & "value" & tab & candidateValue & linefeed
                        end try
                        try
                            set candidateValue to (description of elem) as text
                            if candidateValue is not "" then set output to output & "description" & tab & candidateValue & linefeed
                        end try
                        try
                            set candidateValue to (title of elem) as text
                            if candidateValue is not "" then set output to output & "title" & tab & candidateValue & linefeed
                        end try
                        try
                            set candidateValue to (name of elem) as text
                            if candidateValue is not "" then set output to output & "name" & tab & candidateValue & linefeed
                        end try
                    end if
                end try
            end repeat

            return output
        end tell
    end using terms from
end collect_url_candidates"#,
        process_name = process_name
    )
}

#[cfg(target_os = "macos")]
fn best_browser_url_candidate_from_output(output: &str) -> Option<String> {
    let mut best_match: Option<(i32, String)> = None;

    for raw_line in output.lines() {
        let (source, raw) = parse_browser_url_candidate_line(raw_line);
        if raw.is_empty() {
            continue;
        }

        let Some(url) = normalize_possible_url(raw) else {
            continue;
        };

        if source != BrowserUrlCandidateSource::Value
            && is_suspicious_host_only_browser_candidate(&url)
        {
            continue;
        }

        let mut score = 40 + browser_url_candidate_source_bonus(source);
        if raw.starts_with("http://") || raw.starts_with("https://") || raw.starts_with("file://") {
            score += 40;
        }
        if raw.contains("://") {
            score += 20;
        }
        if let Some((_, rest)) = http_url_host_and_rest(&url) {
            if !rest.is_empty() {
                score += 18;
            }
            if rest.contains('?') || rest.contains('#') {
                score += 8;
            }
        } else if raw.contains('/') || raw.contains('?') || raw.contains('#') {
            score += 10;
        }
        if url.len() > 24 {
            score += 5;
        }

        let replace = best_match
            .as_ref()
            .map(|(best_score, best_url)| {
                score > *best_score || (score == *best_score && url.len() > best_url.len())
            })
            .unwrap_or(true);

        if replace {
            best_match = Some((score, url));
        }
    }

    best_match.map(|(_, url)| url)
}

#[cfg(target_os = "macos")]
fn browser_url_candidates_preview_from_output(output: &str, max_items: usize) -> Vec<String> {
    let mut items = Vec::new();

    for raw_line in output.lines() {
        let (_, raw) = parse_browser_url_candidate_line(raw_line);
        if raw.is_empty() {
            continue;
        }

        let value = normalize_possible_url(raw).unwrap_or_else(|| raw.to_string());
        if items.iter().any(|existing| existing == &value) {
            continue;
        }

        items.push(value);
        if items.len() >= max_items {
            break;
        }
    }

    items
}

#[cfg(target_os = "macos")]
fn get_browser_url_via_system_events(process_name: &str) -> Option<String> {
    let script = browser_url_ui_script_macos(process_name);
    let output = run_monitor_command_with_timeout(
        Command::new("osascript").arg("-e").arg(script),
        &format!("{process_name} URL UI 采集"),
    )
    .ok()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("获取 {process_name} UI URL 失败: {}", stderr.trim());
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if process_name == "Zen" {
        let preview = browser_url_candidates_preview_from_output(&stdout, 8);
        if !preview.is_empty() {
            log::info!("Zen UI URL 候选: {}", preview.join(" | "));
        }
    }
    let url = best_browser_url_candidate_from_output(&stdout);
    if let Some(ref url) = url {
        log_browser_url_once(
            &format!("ui:{process_name}"),
            &format!("获取到 {process_name} UI URL"),
            url,
        );
    }
    url
}

#[cfg(target_os = "macos")]
fn get_browser_url(app_name: &str, window_title: &str) -> Option<String> {
    let app_lower = app_name.to_lowercase();

    if app_lower.contains("firefox") || app_lower.contains("zen") {
        if let Some(url) = firefox_family_session_store_url(app_name, window_title) {
            return Some(url);
        }
    }

    if let Some(process_name) = browser_url_system_events_process_name_macos(&app_lower) {
        if let Some(url) = get_browser_url_via_system_events(process_name) {
            return Some(url);
        }
        log::debug!("{process_name} 未从辅助功能树中提取到 URL");
        return None;
    }

    let Some((script, browser_name)) = browser_url_script_macos(&app_lower) else {
        log::debug!("未识别的浏览器: {app_name}");
        return None;
    };

    log::debug!("尝试获取 {browser_name} URL: {app_name}");

    let output = run_monitor_command_with_timeout(
        Command::new("osascript").arg("-e").arg(script),
        &format!("{browser_name} URL 采集"),
    )
    .ok()?;

    if output.status.success() {
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !url.is_empty() && (url.starts_with("http") || url.starts_with("file")) {
            log_browser_url_once(
                &format!("script:{browser_name}"),
                &format!("获取到 {browser_name} URL"),
                &url,
            );
            Some(url)
        } else {
            log::debug!("{browser_name} 返回空 URL");
            None
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("获取 {} URL 失败: {}", browser_name, stderr.trim());
        None
    }
}

#[cfg(any(target_os = "macos", test))]
#[allow(dead_code)]
fn matches_firefox_family_browser(app_lower: &str) -> bool {
    app_lower.contains("firefox")
        || app_lower.contains("zen")
        || app_lower.contains("librewolf")
        || app_lower.contains("waterfox")
}

#[cfg(target_os = "macos")]
pub fn resolve_browser_url_for_window(app_name: &str, window_title: &str) -> Option<String> {
    get_browser_url(app_name, window_title)
}

#[cfg(target_os = "windows")]
pub fn resolve_browser_url_for_window(app_name: &str, window_title: &str) -> Option<String> {
    if !is_browser_app(app_name) {
        return None;
    }
    // 获取前台窗口 hwnd 并尝试读取浏览器 URL
    let hwnd = unsafe { winapi::um::winuser::GetForegroundWindow() };
    if hwnd.is_null() {
        return None;
    }
    get_browser_url_windows(app_name, window_title, hwnd as isize)
}

pub use work_review_core::categorize::{categorize_app, categorize_app_with_rules};

#[cfg(target_os = "macos")]
unsafe fn get_cf_dict_number(
    dict: core_foundation::dictionary::CFDictionaryRef,
    key: &str,
) -> Option<f64> {
    use core_foundation::base::{CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    let cf_key = CFString::new(key);
    let mut val_ref: CFTypeRef = std::ptr::null();
    if core_foundation::dictionary::CFDictionaryGetValueIfPresent(
        dict,
        cf_key.as_CFTypeRef() as *const _,
        &mut val_ref,
    ) == 0
        || val_ref.is_null()
    {
        return None;
    }
    let mut value: f64 = 0.0;
    if core_foundation::number::CFNumberGetValue(
        val_ref as core_foundation::number::CFNumberRef,
        core_foundation::number::kCFNumberFloat64Type,
        &mut value as *mut f64 as *mut _,
    ) {
        Some(value)
    } else {
        None
    }
}
