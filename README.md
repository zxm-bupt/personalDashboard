# 个人工作台 Web 版

一个本地优先的个人工作台 Web 原型，当前聚焦两个功能：

- 任务管理：任务标题、描述、DDL、重要程度、网页 URL / 本地文件 / 本地应用资源
- 时间记录：番茄钟、上下班打卡、任务专注计时

Web 版只支持 **网页 URL**。Tauri 桌面版支持本地文件、本地应用和网页 URL，并会在文件或应用不存在时提示是否取消与任务的关联。

## 功能

### 任务
- 添加、编辑、删除任务
- 任务标题、描述、DDL、重要程度
- 任务状态：待办 / 进行中 / 已完成
- 每个任务可关联多个资源：网页 URL / 本地文件 / 本地应用
- Dashboard 中直接点击打开资源
- 桌面端打开不存在的文件或应用时，提示并支持取消任务关联

### 番茄钟
- 默认 25 分钟专注 / 5 分钟短休息 / 15 分钟长休息
- 支持自定义时长
- 每完成 4 个番茄进入长休息
- 完整完成的番茄会写入时间明细
- 可关联具体任务

### 时间记录
- 上下班打卡
- 任务专注计时
- 当前计时实时显示
- 最近时间明细
- 打卡历史
- 今日专注和今日番茄统计

### 数据
- 浏览器 localStorage 持久化
- 支持导出 JSON
- 支持清空数据

## 技术栈

- React 19
- TypeScript
- Vite
- Tauri 2
- Rust
- SQLite / rusqlite
- 浏览器模式使用 `localStorage`
- Oxlint

## 本地运行

### 方式一：nix-shell

```bash
nix-shell
pnpm install
pnpm dev:host
```

### 方式二：已有 Node / pnpm

```bash
pnpm install
pnpm dev
```

## Tauri 桌面端

当前项目已经接入 Tauri 2。

- Web 方式运行：继续使用 localStorage
- Tauri 方式运行：使用 SQLite 本地数据库

### 本地 Tauri 开发

```bash
nix-shell
pnpm install
pnpm tauri dev
```

注意：NixOS 当前没有 GUI 时，Tauri 窗口无法直接显示。可以在有图形界面的 Linux/macOS 机器上运行，或者只通过 CI 构建 macOS 安装包。

### 构建 Linux 桌面端

```bash
nix-shell
pnpm tauri:build
```

### 构建 macOS 桌面端

本项目已经加入：

```text
.github/workflows/build-macos.yml
```

推送到 GitHub 后：

1. 在 Actions 页面手动运行 `Build macOS`
2. 或者打标签，例如：

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. GitHub Actions 会构建并上传 macOS ARM64 DMG

### SQLite 存储位置

Tauri 版数据保存在系统应用数据目录：

- macOS：`~/Library/Application Support/com.personal.workbench/workbench.sqlite3`
- Linux：通常是 `~/.local/share/com.personal.workbench/workbench.sqlite3`
- Windows：`%APPDATA%/com.personal.workbench/workbench.sqlite3`

前端页面在浏览器中运行时仍然使用 localStorage；只有在 Tauri 窗口中运行时才会自动切换到 SQLite。

## NixOS 无 GUI 下查看前端

在 NixOS 上启动开发服务器：

```bash
pnpm dev:host
```

然后在有图形界面的另一台机器上使用 SSH 端口转发：

```bash
ssh -N -L 5173:127.0.0.1:5173 user@nixos-arm
```

本地浏览器访问：

```text
http://localhost:5173
```

也可以使用 headless Chromium 截图：

```bash
nix-shell -p chromium --run \
  'chromium --headless --disable-gpu --screenshot=ui.png --window-size=1440,900 http://localhost:5173'
```

## 构建

```bash
pnpm build
pnpm preview
```

## 数据存储

现在有两套存储模式：

- 浏览器运行：`localStorage`
- Tauri 运行：SQLite

浏览器模式 key：

```text
personal-workbench:v1
```

Tauri 模式数据库文件：

```text
workbench.sqlite3
```

保存在系统应用数据目录中。可以通过页面右上角“导出数据”备份为 JSON 文件。

## 后续扩展

- Web 端后续可以迁移到 IndexedDB / Dexie
- 完善 SQLite 数据迁移和备份
- 配置 macOS 签名和公证
- 增加 Windows / Linux 打包流程
