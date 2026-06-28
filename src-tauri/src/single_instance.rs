//! 桌面端单实例：进程启动时创建命名 mutex（`{identifier}-sim`，与 Tauri 单实例插件同名）。
//! 第二个进程检测到 mutex 已存在后立即聚焦已有主窗口并退出。

#[cfg(windows)]
mod platform {
    use std::process::exit;
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsIconic, SetForegroundWindow,
        ShowWindow, SW_RESTORE,
    };

    const APP_IDENTIFIER: &str = "workshadow";
    const MAIN_WINDOW_TITLE: &str = "WorkShadow";

    static MUTEX_HANDLE: OnceLock<isize> = OnceLock::new();

    fn encode_wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn mutex_name() -> Vec<u16> {
        encode_wide(&format!("{APP_IDENTIFIER}-sim"))
    }

    struct FocusTarget {
        found: HWND,
    }

    unsafe extern "system" fn find_main_window(hwnd: HWND, lparam: LPARAM) -> i32 {
        if hwnd.is_null() {
            return 1;
        }
        let target = &mut *(lparam as *mut FocusTarget);
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return 1;
        }
        let mut buf = vec![0u16; (len as usize) + 1];
        let read = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if read <= 0 {
            return 1;
        }
        let title = String::from_utf16_lossy(&buf[..read as usize]);
        if title == MAIN_WINDOW_TITLE {
            target.found = hwnd;
            return 0;
        }
        1
    }

    fn focus_existing_main_window() {
        let mut target = FocusTarget {
            found: std::ptr::null_mut(),
        };
        unsafe {
            EnumWindows(Some(find_main_window), &mut target as *mut _ as LPARAM);
            if target.found.is_null() {
                return;
            }
            if IsIconic(target.found) != 0 {
                ShowWindow(target.found, SW_RESTORE);
            }
            let _ = SetForegroundWindow(target.found);
        }
    }

    pub fn guard() {
        static GUARDED: OnceLock<()> = OnceLock::new();
        if GUARDED.get().is_some() {
            return;
        }
        let _ = GUARDED.set(());

        let name = mutex_name();
        unsafe {
            let handle = CreateMutexW(std::ptr::null(), 1, name.as_ptr());
            if handle.is_null() {
                exit(1);
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                focus_existing_main_window();
                exit(0);
            }
            let _ = MUTEX_HANDLE.set(handle as isize);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn guard() {}
}

pub fn guard() {
    platform::guard();
}
