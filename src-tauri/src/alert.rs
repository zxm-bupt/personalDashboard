//! 番茄钟到时提醒。应用在前台时交给前端弹应用内提醒；不在前台时改发 macOS 系统通知，
//! 点击通知再把隐藏在托盘里的主窗口唤回来。

use tauri::{AppHandle, Manager, UserAttentionType, Wry};

use crate::tray::show_main_window;

/// 主窗口可见、没有最小化并且拥有焦点，才算用户正看着应用。
/// 切到别的应用后主窗口会失去 key 状态，所以 is_focused 也覆盖了“应用在后台”的情况。
fn is_main_window_foreground(app: &AppHandle<Wry>) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };

    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    visible && !minimized && focused
}

/// 系统通知发不出去，或在没有系统通知实现的平台上，退回到把窗口拉到前台的做法。
fn raise_main_window(app: &AppHandle<Wry>) {
    show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(Some(UserAttentionType::Critical));
    }
}

/// 绑定系统通知的发送方，只能设置一次。打包后用应用自己的 bundle id；
/// 开发模式下没有 .app 包，借用终端的身份，和 tauri-plugin-notification 的做法一致。
#[cfg(target_os = "macos")]
pub fn setup(app: &AppHandle<Wry>) {
    let identifier = if tauri::is_dev() {
        "com.apple.Terminal".to_string()
    } else {
        app.config().identifier.clone()
    };

    if let Err(error) = notify_rust::set_application(&identifier) {
        eprintln!("设置系统通知发送方失败: {error}");
    }
}

#[cfg(target_os = "macos")]
fn send_system_notification(app: &AppHandle<Wry>, title: String, body: String) {
    let app = app.clone();

    // wait_for_response 会一直阻塞到用户点击或通知消失，点击回调由主线程的 run loop 送达，
    // 所以必须放到阻塞线程里等，不能占住主线程
    tauri::async_runtime::spawn_blocking(move || {
        let mut notification = notify_rust::Notification::new();
        notification
            .summary(&title)
            .body(&body)
            .sound_name("NSUserNotificationDefaultSoundName");

        let result = notification.show().and_then(|handle| {
            handle.wait_for_response(|response: &notify_rust::NotificationResponse| {
                // 点击通知正文；关闭或自动消失时什么都不做
                if matches!(response, notify_rust::NotificationResponse::Default) {
                    show_main_window(&app);
                }
            })
        });

        if let Err(error) = result {
            eprintln!("发送番茄钟系统通知失败: {error}");
            raise_main_window(&app);
        }
    });
}

/// 返回 true 表示应用在前台，由前端弹应用内提醒并播放提示音；
/// 返回 false 表示已经改发系统通知（自带系统提示音）。
#[tauri::command]
pub fn pomodoro_alert(app: AppHandle<Wry>, title: String, body: String) -> bool {
    if is_main_window_foreground(&app) {
        return true;
    }

    #[cfg(target_os = "macos")]
    {
        send_system_notification(&app, title, body);
        false
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (title, body);
        raise_main_window(&app);
        true
    }
}
