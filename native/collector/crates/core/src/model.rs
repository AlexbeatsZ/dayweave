use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub platform: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentStatus {
    pub state: String,
    pub pending: i64,
    pub last_error: Option<String>,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceView {
    #[serde(flatten)]
    pub device: Device,
    pub last_seen: i64,
    #[serde(flatten)]
    pub status: AgentStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub id: String,
    pub device_id: String,
    pub timestamp: i64,
    pub duration: i64,
    pub app_name: String,
    pub window_title: String,
    pub browser_url: Option<String>,
    pub category: String,
    pub ocr_text: Option<String>,
    pub screenshot: bool,
    #[serde(default)]
    pub note: String,
}

impl Activity {
    pub fn validate(&self, device_id: &str) -> Result<()> {
        Uuid::parse_str(&self.id)?;
        ensure!(self.device_id == device_id, "device mismatch");
        ensure!(
            self.timestamp >= 0 && self.timestamp <= 32_503_680_000,
            "invalid timestamp"
        );
        ensure!((1..=86_400).contains(&self.duration), "invalid duration");
        ensure!(
            !self.app_name.is_empty() && self.app_name.len() <= 512,
            "invalid app name"
        );
        ensure!(
            self.window_title.len() <= 16_384 && self.note.len() <= 16_384,
            "text too long"
        );
        ensure!(self.category.len() <= 128, "category too long");
        ensure!(
            self.browser_url
                .as_ref()
                .map_or(true, |s| s.len() <= 16_384),
            "URL too long"
        );
        ensure!(
            self.ocr_text.as_ref().map_or(true, |s| s.len() <= 131_072),
            "OCR too long"
        );
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Upload {
    pub activity: Activity,
    pub screenshot_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Batch {
    pub device: Device,
    pub status: AgentStatus,
    pub activities: Vec<Upload>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Acknowledgment {
    pub accepted: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RangeQuery {
    pub from: i64,
    pub to: i64,
    pub device: Option<String>,
    pub q: Option<String>,
    pub before_time: Option<i64>,
    pub before_id: Option<String>,
    pub before_device: Option<String>,
    pub limit: Option<usize>,
}

impl RangeQuery {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.from >= 0 && self.to > self.from && self.to - self.from <= 366 * 86_400,
            "invalid time range"
        );
        if let Some(id) = &self.device {
            Uuid::parse_str(id)?;
        }
        ensure!(
            self.q.as_ref().map_or(true, |q| q.len() <= 512),
            "search too long"
        );
        ensure!(
            self.before_time.is_some() == self.before_id.is_some()
                && self.before_id.is_some() == self.before_device.is_some(),
            "incomplete cursor"
        );
        if let Some(id) = &self.before_id {
            Uuid::parse_str(id)?;
        }
        if let Some(id) = &self.before_device {
            Uuid::parse_str(id)?;
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Cursor {
    pub timestamp: i64,
    pub id: String,
    pub device_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivityPage {
    pub items: Vec<Activity>,
    pub next: Option<Cursor>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppUsage {
    pub app_name: String,
    pub duration: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceUsage {
    pub device_id: String,
    pub duration: i64,
    pub hours: Vec<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Overview {
    pub active_seconds: i64,
    pub device_seconds: i64,
    pub count: i64,
    pub apps: Vec<AppUsage>,
    pub devices: Vec<DeviceUsage>,
}
