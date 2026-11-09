#!/usr/bin/env bash
# 在服务器上安装或升级同步服务（以 root 运行）。可以重复执行：已有的证书、令牌和数据都会保留。
#
#   sudo ./install.sh <公网IP> [端口，默认 8443]
#
# 安装位置：
#   /opt/personal-workbench-sync        程序
#   /etc/personal-workbench-sync        配置：env、token、certs/
#   /var/lib/personal-workbench-sync    数据库
#
# 以专用的系统用户 pwsync 运行，由 systemd 管理。不会修改防火墙，最后会打印需要放行的端口。
set -euo pipefail

SERVICE=personal-workbench-sync
SERVICE_USER=pwsync
APP_DIR=/opt/$SERVICE
CONF_DIR=/etc/$SERVICE
DATA_DIR=/var/lib/$SERVICE
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "用法：sudo $0 <公网IP> [端口]" >&2
  exit 1
fi
IP="$1"
PORT="${2:-8443}"

if [[ $EUID -ne 0 ]]; then
  echo "请用 root 运行：sudo $0 $*" >&2
  exit 1
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  echo "端口要在 1024–65535 之间（服务以普通用户运行，不能监听 1024 以下的端口）" >&2
  exit 1
fi

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "没有找到 node，请先安装 Node.js 24 或更高版本" >&2
  exit 1
fi
if ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "需要 Node.js 24 或更高版本（当前 $("$NODE" --version)）：服务直接运行 TypeScript 并使用内置的 SQLite" >&2
  exit 1
fi
command -v systemctl >/dev/null || { echo "需要 systemd" >&2; exit 1; }
command -v openssl >/dev/null || { echo "需要 openssl" >&2; exit 1; }

echo "==> 系统用户 $SERVICE_USER"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> 安装程序到 $APP_DIR"
mkdir -p "$APP_DIR"
rm -rf "$APP_DIR/src" "$APP_DIR/scripts"
cp -r "$SRC_DIR/src" "$APP_DIR/src"
cp -r "$SRC_DIR/scripts" "$APP_DIR/scripts"
cp "$SRC_DIR/package.json" "$APP_DIR/package.json"
chown -R root:root "$APP_DIR"
chmod -R a+rX,go-w "$APP_DIR"

mkdir -p "$CONF_DIR/certs" "$DATA_DIR"
chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 700 "$DATA_DIR"

echo "==> 证书"
CERTS="$CONF_DIR/certs"
if [[ -f "$CERTS/server.key" ]] && openssl x509 -in "$CERTS/server.crt" -noout -ext subjectAltName 2>/dev/null | grep -q "IP Address:$IP"; then
  echo "沿用已有的服务器证书"
else
  bash "$SRC_DIR/scripts/gen-cert.sh" "$IP" "$CERTS"
fi
# 服务只需要读取服务器证书和私钥；CA 私钥只给 root
chown root:"$SERVICE_USER" "$CERTS/server.key" "$CERTS/fullchain.crt"
chmod 640 "$CERTS/server.key"
chown root:root "$CERTS/ca.key"
chmod 600 "$CERTS/ca.key"

echo "==> 令牌"
NEW_TOKEN=""
if [[ ! -s "$CONF_DIR/token" ]]; then
  NEW_TOKEN="$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)"
  (umask 077; printf '%s' "$NEW_TOKEN" >"$CONF_DIR/token")
fi
chown root:"$SERVICE_USER" "$CONF_DIR/token"
chmod 640 "$CONF_DIR/token"

cat >"$CONF_DIR/env" <<EOF
SYNC_TOKEN_FILE=$CONF_DIR/token
SYNC_TLS_CERT=$CERTS/fullchain.crt
SYNC_TLS_KEY=$CERTS/server.key
SYNC_PORT=$PORT
SYNC_HOST=0.0.0.0
SYNC_DATA_DIR=$DATA_DIR
EOF
chmod 640 "$CONF_DIR/env"
chown root:"$SERVICE_USER" "$CONF_DIR/env"

echo "==> systemd 服务 $SERVICE"
cat >"/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Personal Workbench sync server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=$CONF_DIR/env
# 关闭 Node 对内置 SQLite / 类型擦除的实验特性提示，日志更干净
Environment=NODE_NO_WARNINGS=1
WorkingDirectory=$APP_DIR
ExecStart=$NODE $APP_DIR/src/main.ts
Restart=on-failure
RestartSec=3

# 只允许写数据目录，其余文件系统只读
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=$DATA_DIR
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 1
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "服务没有启动成功，最近的日志：" >&2
  journalctl -u "$SERVICE" -n 30 --no-pager >&2
  exit 1
fi

# 在本机确认 HTTPS 和令牌都正常，并且证书确实由这张 CA 签发
TOKEN_VALUE="$(cat "$CONF_DIR/token")"
if command -v curl >/dev/null; then
  if curl -fsS --max-time 5 --cacert "$CERTS/ca.crt" -H "Authorization: Bearer $TOKEN_VALUE" \
      --resolve "$IP:$PORT:127.0.0.1" "https://$IP:$PORT/v1/ping" >/dev/null; then
    echo "本机自检通过"
  else
    echo "警告：本机自检失败，查看日志：journalctl -u $SERVICE -n 50" >&2
  fi
fi

echo
echo "================ 安装完成 ================"
echo "服务器地址：https://$IP:$PORT"
if [[ -n "$NEW_TOKEN" ]]; then
  echo "令牌（只显示这一次，保存在 $CONF_DIR/token）："
  echo "  $NEW_TOKEN"
else
  echo "令牌：沿用已有的，查看：sudo cat $CONF_DIR/token"
fi
echo
echo "CA 证书（完整复制下面这段，粘贴到每台 Mac 的同步设置里）："
cat "$CERTS/ca.crt"
echo "CA 指纹（和 Mac 上显示的核对）："
openssl x509 -in "$CERTS/ca.crt" -noout -fingerprint -sha256 | sed 's/^.*Fingerprint=/  /'
echo
echo "最后一步：放行端口 $PORT/tcp"
echo "  · 云服务器：在控制台的安全组里放行 TCP $PORT"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  echo "  · 本机 ufw：sudo ufw allow $PORT/tcp"
elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  echo "  · 本机 firewalld：sudo firewall-cmd --permanent --add-port=$PORT/tcp && sudo firewall-cmd --reload"
fi
echo "查看日志：journalctl -u $SERVICE -f"
