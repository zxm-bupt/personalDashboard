mod tray;

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
}

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Checkin {
    id: String,
    date: String,
    clock_in_at: String,
    clock_out_at: Option<String>,
    note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchState {
    tasks: Vec<Task>,
    time_entries: Vec<TimeEntry>,
    checkins: Vec<Checkin>,
    last_opened_resource_id: Option<String>,
}

struct Db(Mutex<Connection>);

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
                   resources_json, created_at, updated_at, completed_at
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
            })
        })
        .map_err(|error| error.to_string())?;

    let tasks = task_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut time_statement = conn
        .prepare(
            "
            SELECT id, task_id, entry_type, started_at, ended_at, note
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
            })
        })
        .map_err(|error| error.to_string())?;

    let time_entries = time_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut checkin_statement = conn
        .prepare(
            "
            SELECT id, date, clock_in_at, clock_out_at, note
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
            })
        })
        .map_err(|error| error.to_string())?;

    let checkins = checkin_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let last_opened_resource_id = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'last_opened_resource_id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    Ok(WorkbenchState {
        tasks,
        time_entries,
        checkins,
        last_opened_resource_id,
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
    } = payload;

    for task in tasks {
        let resources_json =
            serde_json::to_string(&task.resources).map_err(|error| error.to_string())?;

        transaction
            .execute(
                "
                INSERT INTO tasks (
                    id, title, description, due_at, priority, status,
                    resources_json, created_at, updated_at, completed_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
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
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    for entry in time_entries {
        transaction
            .execute(
                "
                INSERT INTO time_entries (
                    id, task_id, entry_type, started_at, ended_at, note
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ",
                params![
                    entry.id,
                    entry.task_id,
                    entry.entry_type,
                    entry.started_at,
                    entry.ended_at,
                    entry.note,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    for checkin in checkins {
        transaction
            .execute(
                "
                INSERT INTO checkins (
                    id, date, clock_in_at, clock_out_at, note
                ) VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![
                    checkin.id,
                    checkin.date,
                    checkin.clock_in_at,
                    checkin.clock_out_at,
                    checkin.note,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction
        .execute(
            "
            INSERT OR REPLACE INTO settings (key, value)
            VALUES ('last_opened_resource_id', ?1)
            ",
            params![last_opened_resource_id],
        )
        .map_err(|error| error.to_string())?;

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

            let connection = Connection::open(app_dir.join("workbench.sqlite3"))?;
            init_db(&connection)?;
            app.manage(Db(Mutex::new(connection)));

            tray::setup(app.handle())?;

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
            tray::update_tray
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
