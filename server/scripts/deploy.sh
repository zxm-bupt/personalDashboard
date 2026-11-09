#!/usr/bin/env bash
# 在 Mac 上执行：把同步服务的代码传到服务器，并在服务器上运行 install.sh。
#
#   ./server/scripts/deploy.sh <ssh 目标，如 root@1.2.3.4 或 ubuntu@1.2.3.4> <公网IP> [端口]
#
# 只传程序和脚本（src/、scripts/、package.json），不会碰服务器上的数据、证书和令牌。
# 远程需要 sudo 权限；用 ssh -t 运行，方便输入 sudo 密码。
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "用法：$0 <ssh目标> <公网IP> [端口]" >&2
  exit 1
fi

TARGET="$1"
IP="$2"
PORT="${3:-8443}"
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR="personal-workbench-sync-src"

echo "==> 上传到 $TARGET:~/$REMOTE_DIR"
# 用 tar 经 ssh 传输，服务器上不需要 rsync
COPYFILE_DISABLE=1 tar -C "$SERVER_DIR" -czf - src scripts package.json \
  | ssh "$TARGET" "rm -rf ~/$REMOTE_DIR && mkdir -p ~/$REMOTE_DIR && tar -xzf - -C ~/$REMOTE_DIR"

echo "==> 在服务器上安装"
ssh -t "$TARGET" "sudo bash ~/$REMOTE_DIR/scripts/install.sh '$IP' '$PORT'"
