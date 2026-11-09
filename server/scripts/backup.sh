#!/usr/bin/env bash
# 在服务器上备份同步数据库（服务运行中也可以执行，得到的是一致的副本）。
#
#   sudo ./backup.sh [备份目录，默认 /var/backups/personal-workbench-sync]
#
# 可以放进 root 的 crontab 每天执行一次，并保留最近 14 份：
#   15 3 * * * /opt/personal-workbench-sync/scripts/backup.sh
set -euo pipefail

SERVICE=personal-workbench-sync
TARGET_DIR="${1:-/var/backups/$SERVICE}"
KEEP=14

if [[ $EUID -ne 0 ]]; then
  echo "请用 root 运行" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
chmod 700 "$TARGET_DIR"
FILE="$TARGET_DIR/sync-$(date +%Y%m%d-%H%M%S).sqlite3"

# 以服务用户身份、读取服务的配置执行，保证打开的是同一个数据库
set -a
# shellcheck disable=SC1091
source "/etc/$SERVICE/env"
set +a
TMP="$(mktemp -d)"
chown pwsync "$TMP"
sudo -u pwsync --preserve-env=SYNC_DATA_DIR NODE_NO_WARNINGS=1 \
  node "/opt/$SERVICE/src/main.ts" backup "$TMP/backup.sqlite3"
mv "$TMP/backup.sqlite3" "$FILE"
rmdir "$TMP"
chmod 600 "$FILE"
echo "已备份：$FILE"

# 只保留最近 KEEP 份
ls -1t "$TARGET_DIR"/sync-*.sqlite3 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
