#[cfg(any(windows, target_os = "macos"))]
/// Idle input prevents unattended applications from accruing activity time.
pub struct IdleDetector {
    idle_timeout_secs: u64,
}
#[cfg(any(windows, target_os = "macos"))]
impl IdleDetector {
    pub fn new(idle_timeout_minutes: u64) -> Self {
        Self {
            idle_timeout_secs: idle_timeout_minutes * 60,
        }
    }
    pub fn is_input_idle(&self) -> bool {
        get_idle_seconds() >= self.idle_timeout_secs
    }
}

#[cfg(windows)]
pub fn foreground_input_age(window: usize) -> Option<i64> {
    windows_input::age(window)
}

#[cfg(windows)]
mod windows_input {
    use std::{
        mem::zeroed,
        ptr::null_mut,
        sync::{mpsc, Mutex, OnceLock},
        thread,
    };
    use winapi::{
        shared::minwindef::{LPARAM, LRESULT, WPARAM},
        um::{libloaderapi::GetModuleHandleW, sysinfoapi::GetTickCount64, winuser::*},
    };

    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    static LAST: Mutex<Option<(usize, u64)>> = Mutex::new(None);

    fn note_input() {
        let window = unsafe { GetForegroundWindow() } as usize;
        if window != 0 {
            // Store only the foreground handle and uptime. Do not retain codes or coordinates.
            *LAST.lock().unwrap() = Some((window, unsafe { GetTickCount64() }));
        }
    }

    unsafe extern "system" fn keyboard(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
        if code >= 0
            && matches!(message as u32, WM_KEYDOWN | WM_SYSKEYDOWN)
            && (*(data as *const KBDLLHOOKSTRUCT)).flags & LLKHF_INJECTED == 0
        {
            note_input();
        }
        CallNextHookEx(null_mut(), code, message, data)
    }

    unsafe extern "system" fn mouse(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
        if code >= 0
            && matches!(
                message as u32,
                WM_LBUTTONDOWN
                    | WM_RBUTTONDOWN
                    | WM_MBUTTONDOWN
                    | WM_XBUTTONDOWN
                    | WM_MOUSEWHEEL
                    | WM_MOUSEHWHEEL
            )
            && (*(data as *const MSLLHOOKSTRUCT)).flags & LLMHF_INJECTED == 0
        {
            note_input();
        }
        CallNextHookEx(null_mut(), code, message, data)
    }

    pub fn age(window: usize) -> Option<i64> {
        if !*AVAILABLE.get_or_init(|| {
            let (send, receive) = mpsc::sync_channel(0);
            thread::spawn(move || unsafe {
                let module = GetModuleHandleW(null_mut());
                let keys = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), module, 0);
                let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), module, 0);
                let ready = !keys.is_null() && !mouse.is_null();
                let _ = send.send(ready);
                if ready {
                    let mut message: MSG = zeroed();
                    while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                        TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
                if !keys.is_null() {
                    UnhookWindowsHookEx(keys);
                }
                if !mouse.is_null() {
                    UnhookWindowsHookEx(mouse);
                }
            });
            receive.recv().unwrap_or(false)
        }) {
            return None;
        }
        let last = *LAST.lock().unwrap();
        Some(match last {
            Some((owner, ms)) if owner == window => {
                (unsafe { GetTickCount64() }.saturating_sub(ms) / 1000) as i64
            }
            _ => i64::MAX,
        })
    }
}

#[cfg(windows)]
fn get_idle_seconds() -> u64 {
    use std::mem::size_of;
    use winapi::um::sysinfoapi::GetTickCount;
    use winapi::um::winuser::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut lii) != 0 {
            (GetTickCount().wrapping_sub(lii.dwTime) / 1000) as u64
        } else {
            0
        }
    }
}

#[cfg(target_os = "macos")]
fn event_age(kind: u32) -> Option<i64> {
    use core_graphics::event_source::CGEventSourceStateID;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: CGEventSourceStateID, kind: u32) -> f64;
    }
    let seconds = unsafe {
        CGEventSourceSecondsSinceLastEventType(CGEventSourceStateID::HIDSystemState, kind)
    };
    (seconds.is_finite() && seconds >= 0.0).then_some(seconds as i64)
}

#[cfg(target_os = "macos")]
pub fn foreground_input_age(_: usize) -> Option<i64> {
    use core_graphics::event::CGEventType;
    [
        CGEventType::KeyDown,
        CGEventType::FlagsChanged,
        CGEventType::LeftMouseDown,
        CGEventType::RightMouseDown,
        CGEventType::OtherMouseDown,
        CGEventType::ScrollWheel,
    ]
    .into_iter()
    .filter_map(|event| event_age(event as u32))
    .min()
}

#[cfg(target_os = "macos")]
fn get_idle_seconds() -> u64 {
    event_age(u32::MAX).unwrap_or(0) as u64
}
