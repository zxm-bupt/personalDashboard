mod alert;
mod sync;
mod sync_client;
mod tray;
#[cfg(target_os = "macos")]
mod tray_icon;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use tauri::{Manager, State, WindowEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskResource {
    id: String,
    kind: String,
    title: String,
    #[serde(alias = "url")]
    target: String,
    /// 添加这个文件/应用资源的设备；旧数据里没有这个字段
    #[serde(default)]
    device_id: Option<String>,
}

// updatedAt / deletedAt 用于同步：updatedAt 判断哪边更新，deletedAt 不为空表示已删除（墓碑）。
// 与 src/types.ts 手动保持一致。

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    title: String,
    description: String,
    due_at: Option<String>,
    priority: String,
    status: String,
    resources: Vec<TaskResource>,
    created_at: String,
    updated_at: String,
    #[serde(default)]
    deleted_at: Option<String>,
    completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimeEntry {
    id: String,
    task_id: Option<String>,
    #[serde(rename = "type")]
    entry_type: String,
    started_at: String,
    ended_at: Option<String>,
    note: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Checkin {
    id: String,
    date: String,
    clock_in_at: String,
    clock_out_at: Option<String>,
    note: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    deleted_at: Option<String>,
}

/// 只属于本机的同步状态，存在 settings 表里，和业务数据在同一个事务中保存。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncMeta {
    device_id: Option<String>,
    cursor: Option<i64>,
    pushed_until: Option<String>,
    last_sync_at: Option<String>,
    server_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchState {
    tasks: Vec<Task>,
    time_entries: Vec<TimeEntry>,
    checkins: Vec<Checkin>,
    last_opened_resource_id: Option<String>,
    #[serde(default)]
    sync: SyncMeta,
}

pub(crate) struct Db(pub(crate) Mutex<Connection>);

/// 读一个设置项；不存在时返回 None。
pub(crate) fn read_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .optional()
}

/// 写一个设置项；值为 None 时删除这个键。
///
/// settings.value 是 NOT NULL，直接插入 NULL 会让 INSERT OR REPLACE 中止，
/// 进而让整个保存事务回滚——旧版本保存 lastOpenedResourceId 时就是这样丢数据的。
pub(crate) fn write_setting(
    conn: &Connection,
    key: &str,
    value: Option<&str>,
) -> rusqlite::Result<()> {
    match value {
        Some(value) => conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?,
        None => conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?,
    };
    Ok(())
}

/// 当前数据库结构版本，记录在 SQLite 的 PRAGMA user_version 里。
const SCHEMA_VERSION: i64 = 1;

/// v1：为同步增加修改时间和删除标记。新列全部允许为空，旧版本程序打开新库也不会因为
/// NOT NULL 约束写入失败；旧记录的修改时间按已有字段补齐。
const MIGRATION_V1: &str = "
    ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
    ALTER TABLE time_entries ADD COLUMN updated_at TEXT;
    ALTER TABLE time_entries ADD COLUMN deleted_at TEXT;
    ALTER TABLE checkins ADD COLUMN updated_at TEXT;
    ALTER TABLE checkins ADD COLUMN deleted_at TEXT;
    UPDATE time_entries SET updated_at = COALESCE(ended_at, started_at) WHERE updated_at IS NULL;
    UPDATE checkins SET updated_at = COALESCE(clock_out_at, clock_in_at) WHERE updated_at IS NULL;
";

/// 按 user_version 依次执行迁移。迁移前如果已有数据，先用 VACUUM INTO 备份一份完整副本
/// （WAL 模式下直接复制文件可能漏掉尚未合并的数据）。迁移在事务里执行，失败会整体回滚。
fn migrate(conn: &mut Connection, app_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }

    let has_data: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tasks)
             OR EXISTS(SELECT 1 FROM time_entries)
             OR EXISTS(SELECT 1 FROM checkins)",
        [],
        |row| row.get(0),
    )?;
    if has_data {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default();
        let backup = app_dir.join(format!("workbench.backup-schema{version}-{stamp}.sqlite3"));
        conn.execute(
            "VACUUM INTO ?1",
            params![backup.to_string_lossy().into_owned()],
        )?;
    }

    let transaction = conn.transaction()?;
    if version < 1 {
        transaction.execute_batch(MIGRATION_V1)?;
    }
    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(())
}

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            due_at TEXT,
            priority TEXT NOT NULL,
            status TEXT NOT NULL,
            resources_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS time_entries (
            id TEXT PRIMARY KEY,
            task_id TEXT,
            entry_type TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            note TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS checkins (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            clock_in_at TEXT NOT NULL,
            clock_out_at TEXT,
            note TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )
}

#[tauri::command]
fn load_workbench(db: State<Db>) -> Result<WorkbenchState, String> {
    let conn = db.0.lock().map_err(|error| error.to_string())?;

    let mut task_statement = conn
        .prepare(
            "
            SELECT id, title, description, due_at, priority, status,
                   resources_json, created_at, updated_at, completed_at, deleted_at
            FROM tasks
            ORDER BY created_at DESC
            ",
        )
        .map_err(|error| error.to_string())?;

    let task_rows = task_statement
        .query_map([], |row| {
            let resources_json: String = row.get(6)?;
            let resources: Vec<TaskResource> =
                serde_json::from_str(&resources_json).unwrap_or_default();

            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                due_at: row.get(3)?,
                priority: row.get(4)?,
                status: row.get(5)?,
                resources,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                completed_at: row.get(9)?,
                deleted_at: row.get(10)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let tasks = task_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut time_statement = conn
        .prepare(
            "
            SELECT id, task_id, entry_type, started_at, ended_at, note,
                   COALESCE(updated_at, ended_at, started_at), deleted_at
            FROM time_entries
            ORDER BY started_at DESC
            ",
        )
        .map_err(|error| error.to_string())?;

    let time_rows = time_statement
        .query_map([], |row| {
            Ok(TimeEntry {
                id: row.get(0)?,
                task_id: row.get(1)?,
                entry_type: row.get(2)?,
                started_at: row.get(3)?,
                ended_at: row.get(4)?,
                note: row.get(5)?,
                updated_at: row.get(6)?,
                deleted_at: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let time_entries = time_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut checkin_statement = conn
        .prepare(
            "
            SELECT id, date, clock_in_at, clock_out_at, note,
                   COALESCE(updated_at, clock_out_at, clock_in_at), deleted_at
            FROM checkins
            ORDER BY clock_in_at DESC
            ",
        )
        .map_err(|error| error.to_string())?;

    let checkin_rows = checkin_statement
        .query_map([], |row| {
            Ok(Checkin {
                id: row.get(0)?,
                date: row.get(1)?,
                clock_in_at: row.get(2)?,
                clock_out_at: row.get(3)?,
                note: row.get(4)?,
                updated_at: row.get(5)?,
                deleted_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let checkins = checkin_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let setting = |key: &str| read_setting(&conn, key).map_err(|error| error.to_string());

    let sync = SyncMeta {
        device_id: setting("device_id")?,
        cursor: setting("sync_cursor")?.and_then(|value| value.parse().ok()),
        pushed_until: setting("sync_pushed_until")?,
        last_sync_at: setting("sync_last_at")?,
        server_id: setting("sync_server_id")?,
    };

    Ok(WorkbenchState {
        tasks,
        time_entries,
        checkins,
        last_opened_resource_id: setting("last_opened_resource_id")?,
        sync,
    })
}

#[tauri::command]
fn save_workbench(db: State<Db>, payload: WorkbenchState) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|error| error.to_string())?;
    let transaction = conn.transaction().map_err(|error| error.to_string())?;

    transaction
        .execute("DELETE FROM tasks", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM time_entries", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM checkins", [])
        .map_err(|error| error.to_string())?;

    let WorkbenchState {
        tasks,
        time_entries,
        checkins,
        last_opened_resource_id,
        sync,
    } = payload;

    for task in tasks {
        let resources_json =
            serde_json::to_string(&task.resources).map_err(|error| error.to_string())?;

        transaction
            .execute(
                "
                INSERT INTO tasks (
                    id, title, description, due_at, priority, status,
                    resources_json, created_at, updated_at, completed_at, deleted_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ",
                params![
                    task.id,
                    task.title,
                    task.description,
                    task.due_at,
                    task.priority,
                    task.status,
                    resources_json,
                    task.created_at,
                    task.updated_at,
                    task.completed_at,
                    task.deleted_at,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    for entry in time_entries {
        transaction
            .execute(
                "
                INSERT INTO time_entries (
                    id, task_id, entry_type, started_at, ended_at, note, updated_at, deleted_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
                params![
                    entry.id,
                    entry.task_id,
                    entry.entry_type,
                    entry.started_at,
                    entry.ended_at,
                    entry.note,
                    entry.updated_at,
                    entry.deleted_at,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    for checkin in checkins {
        transaction
            .execute(
                "
                INSERT INTO checkins (
                    id, date, clock_in_at, clock_out_at, note, updated_at, deleted_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
                params![
                    checkin.id,
                    checkin.date,
                    checkin.clock_in_at,
                    checkin.clock_out_at,
                    checkin.note,
                    checkin.updated_at,
                    checkin.deleted_at,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    // 同步游标和业务数据在同一个事务里落盘：不会出现“游标前进了但拉下来的数据没存上”
    let cursor = sync.cursor.map(|cursor| cursor.to_string());
    let settings: [(&str, Option<&str>); 6] = [
        (
            "last_opened_resource_id",
            last_opened_resource_id.as_deref(),
        ),
        ("device_id", sync.device_id.as_deref()),
        ("sync_cursor", cursor.as_deref()),
        ("sync_pushed_until", sync.pushed_until.as_deref()),
        ("sync_last_at", sync.last_sync_at.as_deref()),
        ("sync_server_id", sync.server_id.as_deref()),
    ];
    for (key, value) in settings {
        write_setting(&transaction, key, value).map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_os() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
fn open_resource(kind: String, target: String) -> Result<(), String> {
    if kind == "url" {
        return open_external(target);
    }

    if kind != "file" && kind != "app" {
        return Err("不支持的资源类型".to_string());
    }

    let path = Path::new(&target);
    if !path.exists() {
        return Err("RESOURCE_NOT_FOUND".to_string());
    }

    open_path_command(path).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let url = url.trim();

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are supported".to_string());
    }

    open_url_command(url).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_url_command(url: &str) -> std::io::Result<std::process::Child> {
    Command::new("open").arg(url).spawn()
}

#[cfg(target_os = "macos")]
fn open_path_command(path: &Path) -> std::io::Result<std::process::Child> {
    Command::new("open").arg(path).spawn()
}

#[cfg(target_os = "windows")]
fn open_url_command(url: &str) -> std::io::Result<std::process::Child> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
}

#[cfg(target_os = "windows")]
fn open_path_command(path: &Path) -> std::io::Result<std::process::Child> {
    Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(path)
        .spawn()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_command(url: &str) -> std::io::Result<std::process::Child> {
    Command::new("xdg-open").arg(url).spawn()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path_command(path: &Path) -> std::io::Result<std::process::Child> {
    Command::new("xdg-open").arg(path).spawn()
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;

            let mut connection = Connection::open(app_dir.join("workbench.sqlite3"))?;
            init_db(&connection)?;
            migrate(&mut connection, &app_dir)?;
            app.manage(Db(Mutex::new(connection)));
            app.manage(sync::SyncState::default());

            tray::setup(app.handle())?;

            #[cfg(target_os = "macos")]
            alert::setup(app.handle());

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭主窗口只隐藏界面，保留托盘里的打卡和番茄钟；退出走托盘菜单。
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_workbench,
            save_workbench,
            get_os,
            open_resource,
            open_external,
            tray::update_tray,
            alert::pomodoro_alert,
            sync::sync_get_config,
            sync::sync_save_config,
            sync::sync_clear_config,
            sync::sync_ping,
            sync::sync_exchange
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        {
            // 点击 Dock 图标时重新显示被隐藏的窗口
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main_window(app_handle);
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}
