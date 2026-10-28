use crate::model::Device;
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyLevel {
    #[default]
    Full,
    Anonymized,
    Ignored,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppPrivacyRule {
    pub app_name: String,
    #[serde(default)]
    pub level: PrivacyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PrivacyConfig {
    pub app_rules: Vec<AppPrivacyRule>,
    pub excluded_keywords: Vec<String>,
    pub excluded_domains: Vec<String>,
    pub excluded_apps: Vec<String>,
}

impl Default for PrivacyConfig {
    fn default() -> Self {
        Self {
            app_rules: ["1Password", "Bitwarden", "Keychain"]
                .iter()
                .map(|name| AppPrivacyRule {
                    app_name: name.to_string(),
                    level: PrivacyLevel::Ignored,
                })
                .collect(),
            excluded_keywords: ["bank", "login", "password", "密码", "银行", "支付"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            excluded_domains: vec![],
            excluded_apps: vec![],
        }
    }
}

impl PrivacyConfig {
    pub fn get_app_privacy_level(&self, app: &str) -> PrivacyLevel {
        let name = crate::categorize::normalize_display_app_name(app).to_lowercase();
        for rule in &self.app_rules {
            let key = crate::categorize::normalize_display_app_name(&rule.app_name).to_lowercase();
            if !key.is_empty() && name.contains(&key) {
                return rule.level;
            }
        }
        if self
            .excluded_apps
            .iter()
            .any(|s| !s.is_empty() && name.contains(&s.to_lowercase()))
        {
            return PrivacyLevel::Ignored;
        }
        PrivacyLevel::Full
    }
    pub fn should_anonymize_by_keyword(&self, title: &str) -> bool {
        self.excluded_keywords
            .iter()
            .any(|s| !s.is_empty() && title.to_lowercase().contains(&s.to_lowercase()))
    }
    pub fn extract_domain(value: &str) -> String {
        let input = if value.contains("://") {
            value.to_string()
        } else {
            format!("https://{value}")
        };
        url::Url::parse(&input)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.trim_end_matches('.').to_lowercase()))
            .unwrap_or_default()
    }
    pub fn domain_matches(domain: &str, blocked: &str) -> bool {
        domain == blocked || domain.ends_with(&format!(".{blocked}"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppCategoryRule {
    pub app_name: String,
    pub category: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomCategory {
    pub key: String,
    pub name: String,
    pub color: String,
    pub icon: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebsiteSemanticRule {
    pub domain: String,
    pub semantic_category: String,
}
pub fn normalize_category_key_private(value: &str, custom_keys: &[String]) -> String {
    let key = value.trim().to_lowercase();
    if custom_keys.contains(&key) {
        key
    } else {
        crate::categorize::normalize_category_key(&key)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenshotDisplayMode {
    ActiveWindow,
    #[default]
    All,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenshotWidthMode {
    #[default]
    Auto,
    Fixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StorageConfig {
    pub screenshot_retention_days: u32,
    pub metadata_retention_days: u32,
    pub storage_limit_mb: u32,
    pub jpeg_quality: u8,
    pub max_image_width: u32,
    pub screenshots_enabled: bool,
    pub screenshot_display_mode: ScreenshotDisplayMode,
    pub screenshot_width_mode: ScreenshotWidthMode,
}
impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            screenshot_retention_days: 3,
            metadata_retention_days: 30,
            storage_limit_mb: 2048,
            jpeg_quality: 85,
            max_image_width: 1280,
            screenshots_enabled: false,
            screenshot_display_mode: ScreenshotDisplayMode::All,
            screenshot_width_mode: ScreenshotWidthMode::Auto,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    pub device: Device,
    pub server_url: Option<String>,
    pub token: Option<String>,
    pub enabled: bool,
    pub browser_enabled: bool,
    pub screenshot_interval: u64,
    pub idle_threshold_minutes: u32,
    pub sync_interval: u64,
    pub ocr_enabled: bool,
    pub storage: StorageConfig,
    pub privacy: PrivacyConfig,
    pub app_category_rules: Vec<AppCategoryRule>,
    pub custom_categories: Vec<CustomCategory>,
    pub website_semantic_rules: Vec<WebsiteSemanticRule>,
}
impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            device: Device {
                id: Uuid::new_v4().to_string(),
                name: std::env::var("COMPUTERNAME")
                    .or_else(|_| std::env::var("HOSTNAME"))
                    .unwrap_or_else(|_| "我的设备".into()),
                platform: std::env::consts::OS.into(),
            },
            server_url: None,
            token: None,
            enabled: true,
            browser_enabled: false,
            screenshot_interval: 10,
            idle_threshold_minutes: 5,
            sync_interval: 30,
            ocr_enabled: false,
            storage: StorageConfig::default(),
            privacy: PrivacyConfig::default(),
            app_category_rules: vec![],
            custom_categories: vec![],
            website_semantic_rules: vec![],
        }
    }
}
impl AgentConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let config: Self = serde_json::from_slice(
            &std::fs::read(path)
                .with_context(|| format!("read {} (run init first)", path.display()))?,
        )?;
        config.validate()?;
        Ok(config)
    }
    pub fn validate(&self) -> Result<()> {
        Uuid::parse_str(&self.device.id)?;
        ensure!(
            !self.device.name.trim().is_empty() && self.device.name.len() <= 256,
            "invalid device name"
        );
        ensure!(
            (2..=300).contains(&self.screenshot_interval),
            "interval must be 2..300 seconds"
        );
        ensure!(
            (1..=120).contains(&self.idle_threshold_minutes),
            "idle threshold must be 1..120 minutes"
        );
        ensure!(
            (5..=3600).contains(&self.sync_interval),
            "sync interval must be 5..3600 seconds"
        );
        ensure!(
            (1..=100).contains(&self.storage.jpeg_quality),
            "JPEG quality must be 1..100"
        );
        ensure!(
            (320..=16384).contains(&self.storage.max_image_width),
            "invalid image width"
        );
        ensure!(
            self.storage.storage_limit_mb >= 64,
            "storage limit must be at least 64 MB"
        );
        if let Some(server) = &self.server_url {
            let url = url::Url::parse(server)?;
            ensure!(
                matches!(url.scheme(), "http" | "https")
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.query().is_none()
                    && url.fragment().is_none()
                    && matches!(url.path(), "" | "/"),
                "server URL must be an HTTP(S) origin without credentials"
            );
            ensure!(
                self.token.as_ref().is_some_and(|t| t.len() >= 32),
                "collector token required (minimum 32 characters)"
            );
        }
        Ok(())
    }
    pub fn import_desktop(&mut self, path: &Path) -> Result<()> {
        let old: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
        let mut current = serde_json::to_value(&*self)?;
        for key in [
            "screenshot_interval",
            "idle_threshold_minutes",
            "storage",
            "privacy",
            "app_category_rules",
            "custom_categories",
            "website_semantic_rules",
        ] {
            if let Some(value) = old.get(key) {
                current[key] = value.clone();
            }
        }
        *self = serde_json::from_value(current)?;
        self.validate()
    }
}

pub fn default_agent_dir() -> PathBuf {
    #[cfg(windows)]
    {
        return PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
            .join("work-review-agent");
    }
    #[cfg(target_os = "macos")]
    {
        return PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
            .join("Library/Application Support/work-review-agent");
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
            .join(".local/share/work-review-agent")
    }
}

pub fn temporary_directory() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::temp_dir().join(".agents")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/tmp/.agents")
    }
}

/// Atomic replacement avoids readers observing partial configuration during reload.
pub fn save_json(path: &Path, value: &impl Serialize) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| -> Result<()> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&serde_json::to_vec_pretty(value)?)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}
