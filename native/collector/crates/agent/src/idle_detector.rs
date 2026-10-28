/// Idle input prevents unattended applications from accruing activity time.
pub struct IdleDetector {
    idle_timeout_secs: u64,
}
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

// ============== Windows 实现 ==============

#[cfg(target_os = "windows")]
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
            let current_tick = GetTickCount();
            let idle_ms = if current_tick >= lii.dwTime {
                current_tick - lii.dwTime
            } else {
                (u32::MAX - lii.dwTime) + current_tick + 1
            };
            (idle_ms / 1000) as u64
        } else {
            0
        }
    }
}

// ============== macOS 实现 ==============

#[cfg(target_os = "macos")]
fn get_idle_seconds() -> u64 {
    // 使用 FFI 直接调用 CGEventSourceSecondsSinceLastEventType
    // 因为 core-graphics crate 不直接暴露这个函数
    use core_graphics::event_source::CGEventSourceStateID;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(
            state_id: CGEventSourceStateID,
            event_type: u32,
        ) -> f64;
    }

    // kCGAnyInputEventType = ~0 (所有输入事件类型)
    const K_CG_ANY_INPUT_EVENT_TYPE: u32 = !0u32;

    let idle_time = unsafe {
        CGEventSourceSecondsSinceLastEventType(
            CGEventSourceStateID::HIDSystemState,
            K_CG_ANY_INPUT_EVENT_TYPE,
        )
    };

    if idle_time >= 0.0 {
        idle_time as u64
    } else {
        0
    }
}
