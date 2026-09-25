use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

/// 托盘菜单点击“开始/暂停番茄钟”时发给前端的事件名，和 src/lib/tray.ts 保持一致。
pub const TOGGLE_POMODORO_EVENT: &str = "tray://toggle-pomodoro";

const MENU_ID_POMODORO_TOGGLE: &str = "pomodoro_toggle";
const MENU_ID_SHOW_WINDOW: &str = "show_window";
const MENU_ID_QUIT: &str = "quit";

/// 前端整体下发的托盘文案，所有格式化都在前端完成。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySnapshot {
    title: String,
    tooltip: String,
    checkin_label: String,
    pomodoro_label: String,
    pomodoro_action_label: String,
}

/// 需要在运行期改写文案的托盘句柄。
pub struct TrayHandles {
    tray: TrayIcon<Wry>,
    checkin_item: MenuItem<Wry>,
    pomodoro_item: MenuItem<Wry>,
    pomodoro_action_item: MenuItem<Wry>,
}

pub fn setup(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let checkin_item = MenuItem::with_id(
        app,
        "checkin_status",
        "今天还没有打卡",
        false,
        None::<&str>,
    )?;
    let pomodoro_item =
        MenuItem::with_id(app, "pomodoro_status", "专注 · 未开始", false, None::<&str>)?;
    let pomodoro_action_item = MenuItem::with_id(
        app,
        MENU_ID_POMODORO_TOGGLE,
        "开始番茄钟",
        true,
        None::<&str>,
    )?;
    let show_item = MenuItem::with_id(app, MENU_ID_SHOW_WINDOW, "显示主界面", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_ID_QUIT, "退出", true, None::<&str>)?;
    let first_separator = PredefinedMenuItem::separator(app)?;
    let second_separator = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &checkin_item,
            &pomodoro_item,
            &first_separator,
            &pomodoro_action_item,
            &second_separator,
            &show_item,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("个人工作台")
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_ID_POMODORO_TOGGLE => {
                if let Err(error) = app.emit(TOGGLE_POMODORO_EVENT, ()) {
                    eprintln!("发送托盘番茄钟事件失败: {error}");
                }
            }
            MENU_ID_SHOW_WINDOW => show_main_window(app),
            MENU_ID_QUIT => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let tray = builder.build(app)?;

    app.manage(TrayHandles {
        tray,
        checkin_item,
        pomodoro_item,
        pomodoro_action_item,
    });

    Ok(())
}

/// 从托盘或 Dock 重新唤起主窗口。
pub fn show_main_window(app: &AppHandle<Wry>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn update_tray(handles: State<'_, TrayHandles>, snapshot: TraySnapshot) -> Result<(), String> {
    handles
        .checkin_item
        .set_text(&snapshot.checkin_label)
        .map_err(|error| error.to_string())?;
    handles
        .pomodoro_item
        .set_text(&snapshot.pomodoro_label)
        .map_err(|error| error.to_string())?;
    handles
        .pomodoro_action_item
        .set_text(&snapshot.pomodoro_action_label)
        .map_err(|error| error.to_string())?;

    // macOS 会把 title 显示在菜单栏图标旁边，空字符串表示不显示。
    let title = if snapshot.title.is_empty() {
        None
    } else {
        Some(snapshot.title.as_str())
    };
    handles
        .tray
        .set_title(title)
        .map_err(|error| error.to_string())?;
    handles
        .tray
        .set_tooltip(Some(snapshot.tooltip.as_str()))
        .map_err(|error| error.to_string())?;

    Ok(())
}
