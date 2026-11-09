# 同步服务器

个人工作台的多设备同步服务。几台 Mac 通过这台服务器同步任务、计时记录和打卡记录。

- 只需要一台有公网 IP 的服务器，**不需要域名**
- 零第三方依赖：只用 Node.js 24 自带的 `node:https` 和 `node:sqlite`，直接运行 TypeScript 源码
- **只提供 HTTPS**：用自建 CA 给服务器的 IP 签发证书，Mac 端只信任这张 CA
- 令牌鉴权；令牌错误次数过多的 IP 会被暂时拒绝

## 准备

服务器上需要：

- Linux + systemd
- Node.js **24 或更高**（`node --version` 确认）
- `openssl`、`curl`（大多数发行版自带）
- 一个能 sudo 的 SSH 账号

## 部署

在 Mac 上、项目根目录执行（把 IP 换成你的服务器公网 IP）：

```bash
./server/scripts/deploy.sh ubuntu@1.2.3.4 1.2.3.4          # 默认端口 8443
./server/scripts/deploy.sh ubuntu@1.2.3.4 1.2.3.4 9443     # 指定端口
```

它会把 `server/` 里的程序和脚本传到服务器，再在服务器上以 root 运行 `install.sh`，完成后打印：

1. **服务器地址**，例如 `https://1.2.3.4:8443`
2. **令牌**（只在第一次安装时显示，之后用 `sudo cat /etc/personal-workbench-sync/token` 查看）
3. **CA 证书**（`-----BEGIN CERTIFICATE-----` 开头的整段）和它的 **SHA-256 指纹**

最后放行端口：云服务器在控制台的**安全组**里放行 TCP 8443；服务器本机开了 ufw / firewalld 的话，
脚本会打印对应的命令。

也可以手动部署：把 `server/` 目录复制到服务器，执行 `sudo ./scripts/install.sh <公网IP> [端口]`。

## 在每台 Mac 上配置

打开个人工作台，点右上角的“设置同步”，填入：

- 服务器地址
- 令牌
- CA 证书（整段粘贴）

点“保存并测试连接”。保存后界面上会显示 CA 指纹，和服务器上打印的指纹核对一致即可。
之后应用会自动同步，右上角显示“已同步 HH:mm”。

第一次同步时，每台 Mac 会把自己已有的全部记录推送上去，再拉取其他设备的记录。以前如果在两台 Mac 上
都打过同一天的卡，合并后时间页的打卡历史里会标出“时间重叠”，修改或删除其中一条即可。

## 安装在哪里

| 位置 | 内容 |
|---|---|
| `/opt/personal-workbench-sync` | 程序和脚本 |
| `/etc/personal-workbench-sync/env` | 配置（端口、证书路径等） |
| `/etc/personal-workbench-sync/token` | 令牌 |
| `/etc/personal-workbench-sync/certs/` | `ca.crt`、`ca.key`（CA 私钥，只有 root 可读）、`fullchain.crt`、`server.key` |
| `/var/lib/personal-workbench-sync/sync.sqlite3` | 数据库 |

服务以专用的系统用户 `pwsync` 运行，systemd 限制它只能写数据目录。

```bash
systemctl status personal-workbench-sync
journalctl -u personal-workbench-sync -f      # 日志里不会出现令牌
```

## 升级

在 Mac 上重新执行一次 `deploy.sh` 即可。证书、令牌和数据都会保留。

## 备份

```bash
sudo /opt/personal-workbench-sync/scripts/backup.sh
```

备份到 `/var/backups/personal-workbench-sync/`，只保留最近 14 份。服务运行中也可以执行，得到的是一致的副本
（不要直接复制正在使用的数据库文件：WAL 模式下可能漏掉还没合并的数据）。想每天自动备份，加进 root 的 crontab：

```cron
15 3 * * * /opt/personal-workbench-sync/scripts/backup.sh
```

即使服务器数据全部丢失，也可以重新安装：各台 Mac 发现服务器的数据库变了，会自动把本机的全部记录重新推送上去。

## 证书

- 服务器证书有效期 5 年，CA 有效期 10 年。
- **服务器换了 IP、或者证书快过期**：在服务器上重新执行 `install.sh <新IP>`。它会沿用原来的 CA、只重新签发服务器证书，
  Mac 端只需要把服务器地址改成新 IP，CA 证书不用重新粘贴。
- **CA 私钥可能泄露**：删除 `/etc/personal-workbench-sync/certs/` 后重新执行 `install.sh`，会生成全新的 CA，
  每台 Mac 都要重新粘贴 CA 证书。
- **更换令牌**：删除 `/etc/personal-workbench-sync/token` 后重新执行 `install.sh`，新令牌会打印出来，每台 Mac 重新填写。

## 常见问题

| 现象 | 原因 |
|---|---|
| 证书校验失败 | 粘贴的 CA 和服务器的不是同一张，或者地址里的 IP 和证书里的不一致。核对指纹和 IP。 |
| 连接不上服务器 | 端口没放行（安全组 / 防火墙），或服务没在运行（`systemctl status`）。 |
| 令牌不正确 | 令牌没复制完整。注意不要带上首尾空格以外的多余字符。 |
| 请求过于频繁 | 15 分钟内令牌错误超过 10 次，这个 IP 被暂时拒绝；等 15 分钟或重启服务。 |
| 提示时间相差很多 | 冲突时按修改时间判断谁更新，请在 Mac 和服务器上都开启自动校时。 |

## 开发

```bash
cd server
node --test "test/**/*.test.ts"          # 测试
./scripts/gen-cert.sh 127.0.0.1 ./certs  # 生成本机测试用证书
SYNC_TOKEN=$(openssl rand -hex 24) SYNC_TLS_CERT=certs/fullchain.crt SYNC_TLS_KEY=certs/server.key \
  SYNC_HOST=127.0.0.1 SYNC_DATA_DIR=./data node src/main.ts
```

同步协议（记录格式和冲突规则）在 `src/protocol.ts`，客户端直接导入这一份文件，两边的规则不会不一致。
