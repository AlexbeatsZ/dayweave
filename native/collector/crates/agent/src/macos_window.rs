//! Read the frontmost window directly; no System Events process or Apple Events.
use crate::{
    error::AppError,
    error::Result,
    monitor::{shale_page_url, WindowBounds, SHALE_ACTIVE_WEBVIEWER_ID},
};
use cocoa::base::{id, nil};
use core_foundation::{
    array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex, CFArrayRef},
    base::{CFEqual, CFGetTypeID, CFHash, CFRelease, CFTypeRef, TCFType},
    string::{CFString, CFStringGetTypeID, CFStringRef},
    url::{CFURLGetString, CFURLGetTypeID, CFURLRef},
};
use core_graphics::geometry::{CGPoint, CGSize};
use objc::{class, msg_send, sel, sel_impl};
use std::{
    collections::VecDeque,
    ffi::{c_void, CStr},
    os::raw::c_char,
    sync::atomic::{AtomicI64, Ordering},
    time::{Duration, Instant},
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
    fn GetFrontProcess(process: *mut ProcessSerialNumber) -> i32;
    fn GetProcessPID(process: *const ProcessSerialNumber, pid: *mut i32) -> i32;
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

#[repr(C)]
#[derive(Default)]
struct ProcessSerialNumber {
    high: u32,
    low: u32,
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
    pub window_id: usize,
    pub app_name: String,
    pub bundle_identifier: String,
    pub app_path: String,
    pub title: String,
    pub bounds: Option<WindowBounds>,
    pub shale_page: Option<(String, String)>,
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

unsafe fn frontmost_pid() -> Result<i32> {
    // This sampler has no AppKit event loop. NSWorkspace can keep returning an old
    // frontmost application, so obtain the current process directly on every sample.
    let mut process = ProcessSerialNumber::default();
    let mut pid = 0;
    let error = GetFrontProcess(&mut process);
    if error != 0 {
        return Err(AppError::Unknown(format!(
            "GetFrontProcess failed: {error}"
        )));
    }
    let error = GetProcessPID(&process, &mut pid);
    if error != 0 || pid <= 0 {
        return Err(AppError::Unknown(format!("GetProcessPID failed: {error}")));
    }
    Ok(pid)
}

pub fn frontmost_window(include_browser_url: bool) -> Result<FrontmostWindow> {
    unsafe {
        let _pool = Pool(msg_send![class!(NSAutoreleasePool), new]);
        let pid = frontmost_pid()?;
        let app: id =
            msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
        if app == nil {
            return Err(AppError::Unknown("没有前台应用".into()));
        }
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
        // The application itself is known from the current process; a failed window read only loses
        // the title, so the activity is still recorded under the application name.
        let mut shale_page = None;
        let window = (|| -> Result<(usize, String, Option<WindowBounds>)> {
            let Some(window) = attribute(application.0, "AXFocusedWindow")? else {
                return Ok((pid as usize, String::new(), None));
            };
            if CFGetTypeID(window.0) != AXUIElementGetTypeID() {
                return Err(AppError::Unknown("辅助功能返回了无效的窗口类型".into()));
            }
            AXUIElementSetMessagingTimeout(window.0, 0.8);
            let title = attribute(window.0, "AXTitle")?
                .and_then(|value| cf_string(value.0))
                .unwrap_or_default();
            if include_browser_url && bundle_identifier == "io.github.alexbeatsz.shale" {
                shale_page = read_shale_page(window.0).filter(|_| {
                    frontmost_pid().ok() == Some(pid)
                        && attribute(application.0, "AXFocusedWindow")
                            .ok()
                            .flatten()
                            .is_some_and(|focused| CFEqual(window.0, focused.0) != 0)
                });
            }
            Ok((
                CFHash(window.0) as usize ^ ((pid as usize) << 32),
                title,
                window_bounds(window.0),
            ))
        })();
        note_window_read(window.is_ok());
        let (window_id, title, bounds) =
            window.unwrap_or_else(|_| (pid as usize, String::new(), None));
        Ok(FrontmostWindow {
            window_id,
            app_name,
            bundle_identifier,
            app_path,
            title,
            bounds,
            shale_page,
        })
    }
}

// Native AXWebArea exposes the committed URL as a CFURL. Search the Shale
// renderer for its marker, then stop at the first document beneath that marker.
unsafe fn read_shale_page(window: CFTypeRef) -> Option<(String, String)> {
    let mut search = AxSearch {
        remaining: 384,
        deadline: Instant::now() + Duration::from_millis(500),
    };
    let host = search.find(window, "AXWebArea")?;
    let marker = search.find(host.0, SHALE_ACTIVE_WEBVIEWER_ID)?;
    let document = search.find(marker.0, "AXWebArea")?;
    let url = attribute(document.0, "AXURL").ok()??;
    let raw = if CFGetTypeID(url.0) == CFURLGetTypeID() {
        cf_string(CFURLGetString(url.0 as CFURLRef) as CFTypeRef)?
    } else {
        cf_string(url.0)?
    };
    let title = attribute(document.0, "AXTitle")
        .ok()
        .flatten()
        .and_then(|value| cf_string(value.0))
        .unwrap_or_default();
    Some((title, shale_page_url(&raw)?))
}

struct AxSearch {
    remaining: usize,
    deadline: Instant,
}

impl AxSearch {
    unsafe fn find(&mut self, root: CFTypeRef, target: &str) -> Option<OwnedCF> {
        use core_foundation::base::CFRetain;

        let mut pending = VecDeque::from([OwnedCF(CFRetain(root))]);
        while let Some(node) = pending.pop_front() {
            if self.remaining == 0 || Instant::now() >= self.deadline {
                return None;
            }
            self.remaining -= 1;
            AXUIElementSetMessagingTimeout(node.0, 0.15);
            // The starting node is intentional. A deeper WebArea is a document
            // boundary and its contents never participate in marker selection.
            if node.0 != root {
                let Some(role) = attribute(node.0, "AXRole")
                    .ok()
                    .flatten()
                    .and_then(|role| cf_string(role.0))
                else {
                    continue;
                };
                if role == "AXWebArea" {
                    if target == "AXWebArea" {
                        return Some(node);
                    }
                    continue;
                }
                if target == SHALE_ACTIVE_WEBVIEWER_ID
                    && attribute(node.0, "AXDOMIdentifier")
                        .ok()
                        .flatten()
                        .and_then(|value| cf_string(value.0))
                        .as_deref()
                        == Some(target)
                {
                    return Some(node);
                }
                if !matches!(role.as_str(), "AXGroup" | "AXScrollArea" | "AXSplitGroup") {
                    continue;
                }
            }
            let Some(children) = attribute(node.0, "AXChildren").ok().flatten() else {
                continue;
            };
            if CFGetTypeID(children.0) != CFArrayGetTypeID() {
                continue;
            }
            let array = children.0 as CFArrayRef;
            let capacity = self.remaining.saturating_sub(pending.len());
            for index in 0..CFArrayGetCount(array).min(capacity as isize) {
                let child = CFArrayGetValueAtIndex(array, index);
                if !child.is_null() && CFGetTypeID(child) == AXUIElementGetTypeID() {
                    pending.push_back(OwnedCF(CFRetain(child)));
                }
            }
        }
        None
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
