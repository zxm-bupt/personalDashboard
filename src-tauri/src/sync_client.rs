//! 同步请求的 HTTPS 传输层。不依赖 Tauri，可以单独编译测试。
//!
//! 证书校验只信任用户粘贴进来的那张自建 CA（`tls_certs_only`），系统内置的根证书全部不用：
//! 只有用这张 CA 签发的服务器证书才能通过，任何公共 CA 签发的证书都会被拒绝。
//! 业务数据原样转发，这里不解析，合并规则在前端（与服务端共用 server/src/protocol.ts）。

use std::fmt;
use std::time::Duration;

use base64::Engine;
use reqwest::{Certificate, Client, RequestBuilder, StatusCode};
use serde_json::Value;
use sha2::{Digest, Sha256};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub enum SyncError {
    InvalidConfig(String),
    Certificate(String),
    Connect(String),
    Timeout,
    Unauthorized,
    RateLimited,
    ProtocolMismatch(String),
    Server { status: u16, message: String },
    InvalidResponse(String),
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyncError::InvalidConfig(message) => write!(f, "{message}"),
            SyncError::Certificate(detail) => write!(
                f,
                "服务器证书校验失败：服务器的证书不是由你粘贴的 CA 签发的，或者证书里的 IP 和服务器地址不一致（{detail}）"
            ),
            SyncError::Connect(detail) => write!(f, "连接不上服务器：{detail}"),
            SyncError::Timeout => write!(f, "连接服务器超时"),
            SyncError::Unauthorized => write!(f, "令牌不正确"),
            SyncError::RateLimited => write!(f, "请求过于频繁或令牌错误次数过多，请稍后再试"),
            SyncError::ProtocolMismatch(message) => write!(f, "{message}"),
            SyncError::Server { status, message } => write!(f, "服务器返回错误 {status}：{message}"),
            SyncError::InvalidResponse(detail) => write!(f, "服务器返回的内容无法识别：{detail}"),
        }
    }
}

impl std::error::Error for SyncError {}

/// 规范化服务器地址：必须是 https，不带路径，去掉末尾的斜杠。
pub fn normalize_server_url(input: &str) -> Result<String, SyncError> {
    let trimmed = input.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(trimmed).map_err(|_| {
        SyncError::InvalidConfig("服务器地址格式不正确，例如 https://1.2.3.4:8443".into())
    })?;

    if url.scheme() != "https" {
        return Err(SyncError::InvalidConfig(
            "服务器地址必须以 https:// 开头：令牌和数据不能明文传输".into(),
        ));
    }
    if url.host_str().is_none() {
        return Err(SyncError::InvalidConfig("服务器地址缺少主机".into()));
    }
    if url.path() != "/" || url.query().is_some() {
        return Err(SyncError::InvalidConfig(
            "服务器地址只需要协议、IP 和端口，例如 https://1.2.3.4:8443".into(),
        ));
    }
    Ok(trimmed.to_string())
}

pub fn parse_ca_certificates(pem: &str) -> Result<Vec<Certificate>, SyncError> {
    let certificates = Certificate::from_pem_bundle(pem.as_bytes()).map_err(|_| {
        SyncError::InvalidConfig("CA 证书格式不正确，请完整复制 ca.crt 的内容".into())
    })?;
    if certificates.is_empty() {
        return Err(SyncError::InvalidConfig(
            "没有找到 CA 证书，请粘贴以 -----BEGIN CERTIFICATE----- 开头的内容".into(),
        ));
    }
    Ok(certificates)
}

/// CA 证书的 SHA-256 指纹（大写、冒号分隔），格式和 `openssl x509 -fingerprint -sha256` 一致，
/// 方便在服务器上核对粘贴的是同一张证书。
pub fn ca_fingerprint(pem: &str) -> Option<String> {
    let body: String = pem
        .lines()
        .skip_while(|line| !line.starts_with("-----BEGIN CERTIFICATE-----"))
        .skip(1)
        .take_while(|line| !line.starts_with("-----END CERTIFICATE-----"))
        .map(str::trim)
        .collect();
    let der = base64::engine::general_purpose::STANDARD
        .decode(body)
        .ok()?;
    let digest = Sha256::digest(der);
    Some(
        digest
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<Vec<_>>()
            .join(":"),
    )
}

fn error_chain(error: &dyn std::error::Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(inner) = source {
        parts.push(inner.to_string());
        source = inner.source();
    }
    parts.join(": ")
}

fn classify(error: reqwest::Error) -> SyncError {
    if error.is_timeout() {
        return SyncError::Timeout;
    }
    let chain = error_chain(&error);
    let lower = chain.to_lowercase();
    if lower.contains("certificate")
        || lower.contains("unknownissuer")
        || lower.contains("notvalidforname")
    {
        return SyncError::Certificate(chain);
    }
    SyncError::Connect(chain)
}

#[derive(Clone)]
pub struct SyncClient {
    http: Client,
    base: String,
}

impl SyncClient {
    pub fn new(server_url: &str, ca_pem: &str) -> Result<Self, SyncError> {
        let base = normalize_server_url(server_url)?;
        let certificates = parse_ca_certificates(ca_pem)?;
        let http = Client::builder()
            .tls_certs_only(certificates)
            .https_only(true)
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .user_agent(concat!("personal-workbench/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| SyncError::InvalidConfig(format!("无法创建 HTTPS 客户端：{error}")))?;
        Ok(Self { http, base })
    }

    async fn send(&self, request: RequestBuilder, token: &str) -> Result<Value, SyncError> {
        let response = request.bearer_auth(token).send().await.map_err(classify)?;
        let status = response.status();
        let body = response.bytes().await.map_err(classify)?;
        let json: Option<Value> = serde_json::from_slice(&body).ok();
        let message = json
            .as_ref()
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        match status {
            StatusCode::OK => json.ok_or_else(|| SyncError::InvalidResponse("不是 JSON".into())),
            StatusCode::UNAUTHORIZED => Err(SyncError::Unauthorized),
            StatusCode::TOO_MANY_REQUESTS => Err(SyncError::RateLimited),
            StatusCode::CONFLICT => Err(SyncError::ProtocolMismatch(message)),
            other => Err(SyncError::Server {
                status: other.as_u16(),
                message,
            }),
        }
    }

    pub async fn ping(&self, token: &str) -> Result<Value, SyncError> {
        self.send(self.http.get(format!("{}/v1/ping", self.base)), token)
            .await
    }

    pub async fn sync(&self, token: &str, request: &Value) -> Result<Value, SyncError> {
        self.send(
            self.http
                .post(format!("{}/v1/sync", self.base))
                .header("Content-Type", "application/json")
                .body(request.to_string()),
            token,
        )
        .await
    }
}
