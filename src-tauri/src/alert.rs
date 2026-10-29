//! 番茄钟到时提醒。应用在前台时交给前端弹应用内提醒；不在前台时改发 macOS 系统通知：
//! 点击通知正文把隐藏在托盘里的主窗口唤回来，点击“开始休息 / 开始专注”按钮则留在
//! 当前应用，直接开始下一阶段。
//!
//! 按钮只在通知样式为“提醒”（Alerts）时常驻显示，“横幅”（Banners）样式下会被系统隐藏。
//! 所以 src-tauri/Info.plist 把 NSUserNotificationAlertStyle 默认设为 alert。

use serde::Deserialize;
#[cfg(target_os = "macos")]
use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::Emitter;
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

/// 前端整体下发的提醒内容，文案全部由前端格式化，和托盘的 TraySnapshot 同一个思路。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct AlertContent {
    title: String,
    body: String,
    /// 通知按钮上的文字，例如“开始休息”“开始专注”。
    action_label: String,
    /// 下一阶段。Rust 不解析它，按钮被点击时原样带回给前端核对。
    next_phase: String,
}

/// 通知按钮被点击时发给前端的事件名，和 src/lib/alert.ts 保持一致。
#[cfg(target_os = "macos")]
const START_NEXT_EVENT: &str = "pomodoro://start-next";
#[cfg(target_os = "macos")]
const ACTION_START_NEXT: &str = "start_next";

#[cfg(target_os = "macos")]
#[derive(Clone, Serialize)]
struct StartNextPayload {
    phase: String,
}

#[cfg(target_os = "macos")]
fn send_system_notification(app: &AppHandle<Wry>, content: AlertContent) {
    let app = app.clone();

    // wait_for_response 会一直阻塞到用户点击或通知消失，点击回调由主线程的 run loop 送达，
    // 所以必须放到阻塞线程里等，不能占住主线程
    tauri::async_runtime::spawn_blocking(move || {
        use notify_rust::{Notification, NotificationResponse};

        let mut notification = Notification::new();
        notification
            .summary(&content.title)
            .body(&content.body)
            .action(ACTION_START_NEXT, &content.action_label)
            .sound_name("NSUserNotificationDefaultSoundName");

        let on_response = |response: &NotificationResponse| match response {
            // 点击通知正文：回到应用
            NotificationResponse::Default => show_main_window(&app),
            // 点击“开始休息 / 开始专注”：留在当前应用，只让番茄钟进入下一阶段
            NotificationResponse::Action(id) if id.as_str() == ACTION_START_NEXT => {
                let payload = StartNextPayload {
                    phase: content.next_phase.clone(),
                };
                if let Err(error) = app.emit(START_NEXT_EVENT, payload) {
                    eprintln!("发送开始下一阶段事件失败: {error}");
                }
            }
            // 关闭或自动消失时什么都不做
            _ => {}
        };

        let result = notification
            .show()
            .and_then(|handle| handle.wait_for_response(on_response));

        if let Err(error) = result {
            eprintln!("发送番茄钟系统通知失败: {error}");
            raise_main_window(&app);
        }
    });
}

/// 返回 true 表示应用在前台，由前端弹应用内提醒并播放提示音；
/// 返回 false 表示已经改发系统通知（自带系统提示音和“开始下一阶段”按钮）。
#[tauri::command]
pub fn pomodoro_alert(app: AppHandle<Wry>, content: AlertContent) -> bool {
    if is_main_window_foreground(&app) {
        return true;
    }

    #[cfg(target_os = "macos")]
    {
        send_system_notification(&app, content);
        false
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = content;
        raise_main_window(&app);
        true
    }
}
