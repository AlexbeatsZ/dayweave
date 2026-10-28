//! Read the frontmost window directly; no System Events process or Apple Events.
use crate::{error::AppError, error::Result, monitor::WindowBounds};
use cocoa::base::{id, nil};
use core_foundation::{
    base::{CFGetTypeID, CFRelease, CFTypeRef, TCFType},
    string::{CFString, CFStringGetTypeID, CFStringRef},
};
use core_graphics::geometry::{CGPoint, CGSize};
use objc::{class, msg_send, sel, sel_impl};
use std::{
    ffi::{c_void, CStr},
    os::raw::c_char,
    sync::atomic::{AtomicI64, Ordering},
};

/// Start of the current run of failed window reads; 0 while reads succeed.
static WINDOW_READ_FAILING_SINCE: AtomicI64 = AtomicI64::new(0);

/// A long-running process can lose its accessibility connection (every read then returns
/// kAXErrorCannotComplete until restart), so the caller restarts once failures persist.
pub fn window_read_failing_since() -> Option<i64> {
    match WINDOW_READ_FAILING_SINCE.load(Ordering::Relaxed) {
        0 => None,
        since => Some(since),
    }
}

fn note_window_read(ok: bool) {
    if ok {
        WINDOW_READ_FAILING_SINCE.store(0, Ordering::Relaxed);
    } else {
        let _ = WINDOW_READ_FAILING_SINCE.compare_exchange(
            0,
            chrono::Utc::now().timestamp(),
            Ordering::Relaxed,
            Ordering::Relaxed,
        );
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(
        element: CFTypeRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementSetMessagingTimeout(element: CFTypeRef, seconds: f32) -> i32;
    fn AXUIElementGetTypeID() -> usize;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetValue(value: CFTypeRef, kind: i32, result: *mut c_void) -> bool;
}

struct OwnedCF(CFTypeRef);
impl Drop for OwnedCF {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}
struct Pool(id);
impl Drop for Pool {
    fn drop(&mut self) {
        unsafe {
            let _: () = msg_send![self.0, drain];
        }
    }
}

pub struct FrontmostWindow {
    pub app_name: String,
    pub bundle_identifier: String,
    pub app_path: String,
    pub title: String,
    pub bounds: Option<WindowBounds>,
}

unsafe fn window_bounds(window: CFTypeRef) -> Option<WindowBounds> {
    let position = attribute(window, "AXPosition").ok()??;
    let size = attribute(window, "AXSize").ok()??;
    if CFGetTypeID(position.0) != AXValueGetTypeID() || CFGetTypeID(size.0) != AXValueGetTypeID() {
        return None;
    }
    let mut point = CGPoint::new(0.0, 0.0);
    let mut extent = CGSize::new(0.0, 0.0);
    if !AXValueGetValue(position.0, 1, &mut point as *mut _ as *mut c_void)
        || !AXValueGetValue(size.0, 2, &mut extent as *mut _ as *mut c_void)
        || !point.x.is_finite()
        || !point.y.is_finite()
        || !extent.width.is_finite()
        || !extent.height.is_finite()
        || extent.width <= 0.0
        || extent.height <= 0.0
    {
        return None;
    }
    Some(WindowBounds {
        x: point.x as i32,
        y: point.y as i32,
        width: extent.width as u32,
        height: extent.height as u32,
    })
}

unsafe fn ns_string(value: id) -> String {
    if value == nil {
        return String::new();
    }
    let text: *const c_char = msg_send![value, UTF8String];
    if text.is_null() {
        String::new()
    } else {
        CStr::from_ptr(text).to_string_lossy().into_owned()
    }
}

unsafe fn cf_string(value: CFTypeRef) -> Option<String> {
    if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
        return None;
    }
    Some(CFString::wrap_under_get_rule(value as CFStringRef).to_string())
}

unsafe fn attribute(element: CFTypeRef, name: &str) -> Result<Option<OwnedCF>> {
    let key = CFString::new(name);
    let mut value = std::ptr::null();
    let error = AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value);
    match error {
        0 if !value.is_null() => Ok(Some(OwnedCF(value))),
        // Unsupported or absent values are normal for applications without a window.
        0 | -25205 | -25212 => Ok(None),
        error => Err(AppError::Unknown(format!("macOS {name}: AX error {error}"))),
    }
}

pub fn frontmost_window() -> Result<FrontmostWindow> {
    unsafe {
        let _pool = Pool(msg_send![class!(NSAutoreleasePool), new]);
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: id = msg_send![workspace, frontmostApplication];
        if app == nil {
            return Err(AppError::Unknown("没有前台应用".into()));
        }
        let pid: i32 = msg_send![app, processIdentifier];
        let app_name = ns_string(msg_send![app, localizedName]);
        let bundle_identifier = ns_string(msg_send![app, bundleIdentifier]);
        let url: id = msg_send![app, bundleURL];
        let app_path = if url == nil {
            String::new()
        } else {
            ns_string(msg_send![url, path])
        };
        let element = AXUIElementCreateApplication(pid);
        if element.is_null() {
            return Err(AppError::Unknown("无法读取前台应用的辅助功能信息".into()));
        }
        let application = OwnedCF(element);
        AXUIElementSetMessagingTimeout(application.0, 0.8);
        // The application itself is known from NSWorkspace; a failed window read only loses
        // the title, so the activity is still recorded under the application name.
        let window = (|| -> Result<(String, Option<WindowBounds>)> {
            let Some(window) = attribute(application.0, "AXFocusedWindow")? else {
                return Ok((String::new(), None));
            };
            if CFGetTypeID(window.0) != AXUIElementGetTypeID() {
                return Err(AppError::Unknown("辅助功能返回了无效的窗口类型".into()));
            }
            AXUIElementSetMessagingTimeout(window.0, 0.8);
            let title = attribute(window.0, "AXTitle")?
                .and_then(|value| cf_string(value.0))
                .unwrap_or_default();
            Ok((title, window_bounds(window.0)))
        })();
        note_window_read(window.is_ok());
        let (title, bounds) = window.unwrap_or_default();
        Ok(FrontmostWindow {
            app_name,
            bundle_identifier,
            app_path,
            title,
            bounds,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_foundation::number::CFNumber;

    #[test]
    fn native_title_conversion_preserves_unicode_and_checks_cf_type() {
        let title = CFString::new("工作记录 — test");
        let number = CFNumber::from(7_i32);
        unsafe {
            assert_eq!(
                cf_string(title.as_CFTypeRef()).as_deref(),
                Some("工作记录 — test")
            );
            assert_eq!(cf_string(number.as_CFTypeRef()), None);
            assert_eq!(cf_string(std::ptr::null()), None);
        }
    }
}
