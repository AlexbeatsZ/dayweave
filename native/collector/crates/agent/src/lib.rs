pub mod capture;
#[cfg(any(windows, target_os = "macos"))]
pub mod command;
pub mod legacy;
pub mod sync;
pub mod config {
    pub use work_review_core::config::*;
}
#[cfg(any(windows, target_os = "macos"))]
pub mod error;
#[cfg(any(windows, target_os = "macos"))]
pub mod idle_detector;
#[cfg(target_os = "macos")]
mod macos_window;
#[cfg(any(windows, target_os = "macos"))]
pub mod monitor;
#[cfg(any(windows, target_os = "macos"))]
pub mod ocr;
#[cfg(any(windows, target_os = "macos"))]
pub mod screen_lock;
#[cfg(any(windows, target_os = "macos"))]
pub mod screenshot;
