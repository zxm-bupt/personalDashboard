//! 同步的 Tauri 命令：保存服务器配置、令牌放进钥匙串、转发同步请求。
//!
//! 和托盘一样，Rust 这边不解析业务数据：前端组好请求，这里原样转发，再把服务器的响应原样交回前端，
//! 合并规则只在前端和服务端（server/src/protocol.ts）各有一份共用代码。

use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::sync_client::{ca_fingerprint, normalize_server_url, parse_ca_certificates, SyncClient};
use crate::{read_setting, write_setting, Db};

const KEY_SERVER_URL: &str = "sync_server_url";
const KEY_CA_PEM: &str = "sync_ca_pem";

/// 服务端要求令牌至少 32 个字符；在这里先挡住粘贴不完整的情况。
const MIN_TOKEN_LENGTH: usize = 32;

/// 令牌存放：macOS 放进钥匙串；其他平台（只有 Linux 开发环境）退回 settings 表。
mod token_store {
    #[cfg(target_os = "macos")]
    mod imp {
        use security_framework::passwords::{
            delete_generic_password, get_generic_password, set_generic_password,
        };

        const SERVICE: &str = "com.personal.workbench.sync";
        const ACCOUNT: &str = "token";
        /// errSecItemNotFound：钥匙串里没有这一项
        const ITEM_NOT_FOUND: i32 = -25300;

        pub fn load(_db: &rusqlite::Connection) -> Result<Option<String>, String> {
            match get_generic_password(SERVICE, ACCOUNT) {
                Ok(bytes) => String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|_| "钥匙串里的令牌已损坏".to_string()),
                Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
                Err(error) => Err(format!("读取钥匙串失败：{error:?}")),
            }
        }

        pub fn save(_db: &rusqlite::Connection, token: &str) -> Result<(), String> {
            set_generic_password(SERVICE, ACCOUNT, token.as_bytes())
                .map_err(|error| format!("写入钥匙串失败：{error:?}"))
        }

        pub fn delete(_db: &rusqlite::Connection) -> Result<(), String> {
            match delete_generic_password(SERVICE, ACCOUNT) {
                Ok(()) => Ok(()),
                Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
                Err(error) => Err(format!("删除钥匙串里的令牌失败：{error:?}")),
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    mod imp {
        use crate::{read_setting, write_setting};

        const KEY: &str = "sync_token";

        pub fn load(db: &rusqlite::Connection) -> Result<Option<String>, String> {
            read_setting(db, KEY).map_err(|error| error.to_string())
        }

        pub fn save(db: &rusqlite::Connection, token: &str) -> Result<(), String> {
            write_setting(db, KEY, Some(token)).map_err(|error| error.to_string())
        }

        pub fn delete(db: &rusqlite::Connection) -> Result<(), String> {
            write_setting(db, KEY, None).map_err(|error| error.to_string())
        }
    }

    pub use imp::{delete, load, save};
}

/// 缓存好的 HTTPS 客户端，配置变化时清掉重建。
#[derive(Default)]
pub struct SyncState {
    client: Mutex<Option<SyncClient>>,
}

/// 给前端看的配置。令牌保存后不再返回给前端，只告诉它“有没有”。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigView {
    configured: bool,
    server_url: Option<String>,
    has_token: bool,
    has_ca: bool,
    ca_fingerprint: Option<String>,
}

struct StoredConfig {
    server_url: Option<String>,
    ca_pem: Option<String>,
    token: Option<String>,
}

fn load_config(db: &State<'_, Db>) -> Result<StoredConfig, String> {
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    Ok(StoredConfig {
        server_url: read_setting(&conn, KEY_SERVER_URL).map_err(|error| error.to_string())?,
        ca_pem: read_setting(&conn, KEY_CA_PEM).map_err(|error| error.to_string())?,
        token: token_store::load(&conn)?,
    })
}

fn view(config: &StoredConfig) -> SyncConfigView {
    SyncConfigView {
        configured: config.server_url.is_some()
            && config.ca_pem.is_some()
            && config.token.is_some(),
        server_url: config.server_url.clone(),
        has_token: config.token.is_some(),
        has_ca: config.ca_pem.is_some(),
        ca_fingerprint: config.ca_pem.as_deref().and_then(ca_fingerprint),
    }
}

/// 取出（或新建）客户端和令牌。锁只在这个同步函数里持有，绝不跨过 await。
fn client_and_token(
    db: &State<'_, Db>,
    state: &State<'_, SyncState>,
) -> Result<(SyncClient, String), String> {
    let config = load_config(db)?;
    let (Some(url), Some(ca), Some(token)) = (config.server_url, config.ca_pem, config.token)
    else {
        return Err("还没有配置同步服务器".into());
    };

    let mut cached = state.client.lock().map_err(|error| error.to_string())?;
    let client = match cached.as_ref() {
        Some(client) => client.clone(),
        None => {
            let client = SyncClient::new(&url, &ca).map_err(|error| error.to_string())?;
            *cached = Some(client.clone());
            client
        }
    };
    Ok((client, token))
}

fn invalidate(state: &State<'_, SyncState>) -> Result<(), String> {
    *state.client.lock().map_err(|error| error.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn sync_get_config(db: State<'_, Db>) -> Result<SyncConfigView, String> {
    Ok(view(&load_config(&db)?))
}

/// 保存配置。token / ca_pem 传 None 表示沿用已保存的值（界面上留空即不修改）。
#[tauri::command]
pub fn sync_save_config(
    db: State<'_, Db>,
    state: State<'_, SyncState>,
    server_url: String,
    token: Option<String>,
    ca_pem: Option<String>,
) -> Result<SyncConfigView, String> {
    let url = normalize_server_url(&server_url).map_err(|error| error.to_string())?;
    let token = token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let ca_pem = ca_pem
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(token) = &token {
        if token.chars().count() < MIN_TOKEN_LENGTH {
            return Err(format!(
                "令牌太短（至少 {MIN_TOKEN_LENGTH} 个字符），请确认完整复制了"
            ));
        }
    }

    let existing = load_config(&db)?;
    let ca = ca_pem.clone().or(existing.ca_pem).ok_or("请粘贴 CA 证书")?;
    if token.is_none() && existing.token.is_none() {
        return Err("请填写令牌".into());
    }
    parse_ca_certificates(&ca).map_err(|error| error.to_string())?;
    // 用新配置真正建一次客户端，配置有问题在保存时就报出来
    SyncClient::new(&url, &ca).map_err(|error| error.to_string())?;

    {
        let conn = db.0.lock().map_err(|error| error.to_string())?;
        write_setting(&conn, KEY_SERVER_URL, Some(&url)).map_err(|error| error.to_string())?;
        write_setting(&conn, KEY_CA_PEM, Some(&ca)).map_err(|error| error.to_string())?;
        if let Some(token) = &token {
            token_store::save(&conn, token)?;
        }
    }
    invalidate(&state)?;
    Ok(view(&load_config(&db)?))
}

#[tauri::command]
pub fn sync_clear_config(db: State<'_, Db>, state: State<'_, SyncState>) -> Result<(), String> {
    {
        let conn = db.0.lock().map_err(|error| error.to_string())?;
        write_setting(&conn, KEY_SERVER_URL, None).map_err(|error| error.to_string())?;
        write_setting(&conn, KEY_CA_PEM, None).map_err(|error| error.to_string())?;
        token_store::delete(&conn)?;
    }
    invalidate(&state)
}

#[tauri::command]
pub async fn sync_ping(db: State<'_, Db>, state: State<'_, SyncState>) -> Result<Value, String> {
    let (client, token) = client_and_token(&db, &state)?;
    client.ping(&token).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sync_exchange(
    db: State<'_, Db>,
    state: State<'_, SyncState>,
    request: Value,
) -> Result<Value, String> {
    let (client, token) = client_and_token(&db, &state)?;
    client
        .sync(&token, &request)
        .await
        .map_err(|error| error.to_string())
}
