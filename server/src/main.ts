import { mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { join, resolve } from 'node:path'
import { createSyncHandler } from './app.ts'
import { SyncStore } from './store.ts'

/**
 * 同步服务入口。只提供 HTTPS：令牌和数据都不能以明文形式经过公网。
 *
 *   node src/main.ts                 启动服务
 *   node src/main.ts backup <文件>   生成一份一致的数据库备份（服务运行时也可以执行）
 *
 * 配置全部来自环境变量（install.sh 会写到 /etc/personal-workbench-sync/env）：
 *   SYNC_TOKEN 或 SYNC_TOKEN_FILE   访问令牌，至少 32 个字符
 *   SYNC_TLS_CERT / SYNC_TLS_KEY    服务端证书（含证书链）和私钥
 *   SYNC_PORT                       监听端口，默认 8443
 *   SYNC_HOST                       监听地址，默认 0.0.0.0
 *   SYNC_DATA_DIR                   数据目录，默认 ./data
 */

const MIN_TOKEN_LENGTH = 32

function fail(message: string): never {
  console.error(`启动失败：${message}`)
  process.exit(1)
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) fail(`缺少环境变量 ${name}`)
  return value
}

function readText(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    fail(`无法读取${what} ${path}：${error instanceof Error ? error.message : String(error)}`)
  }
}

function loadToken(): string {
  const file = process.env.SYNC_TOKEN_FILE?.trim()
  const token = (file ? readText(file, '令牌文件') : process.env.SYNC_TOKEN ?? '').trim()
  if (!token) fail('没有配置令牌：设置 SYNC_TOKEN 或 SYNC_TOKEN_FILE')
  if (token.length < MIN_TOKEN_LENGTH) fail(`令牌太短，至少需要 ${MIN_TOKEN_LENGTH} 个字符`)
  return token
}

function openStore(): SyncStore {
  const dataDir = resolve(process.env.SYNC_DATA_DIR?.trim() || './data')
  mkdirSync(dataDir, { recursive: true })
  return new SyncStore(join(dataDir, 'sync.sqlite3'))
}

function runBackup(target: string | undefined): void {
  if (!target) fail('用法：node src/main.ts backup <备份文件路径>')
  const store = openStore()
  store.backupTo(resolve(target))
  store.close()
  console.log(`已备份到 ${resolve(target)}`)
}

function runServer(): void {
  const token = loadToken()
  const cert = readText(required('SYNC_TLS_CERT'), '证书文件')
  const key = readText(required('SYNC_TLS_KEY'), '私钥文件')
  const port = Number(process.env.SYNC_PORT ?? 8443)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) fail('SYNC_PORT 不是合法端口')
  const host = process.env.SYNC_HOST?.trim() || '0.0.0.0'

  const store = openStore()
  const server = createServer(
    { cert, key, minVersion: 'TLSv1.2' },
    createSyncHandler({ store, token }),
  )
  // 慢速连接不能一直占着服务
  server.headersTimeout = 15_000
  server.requestTimeout = 60_000

  server.listen(port, host, () => {
    console.log(`同步服务已启动：https://${host}:${port}（serverId ${store.serverId}）`)
  })

  const shutdown = (signal: string) => {
    console.log(`收到 ${signal}，正在关闭`)
    server.close(() => {
      store.close()
      process.exit(0)
    })
    // 有连接迟迟不断开时也要退出
    setTimeout(() => process.exit(0), 5_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

if (process.argv[2] === 'backup') {
  runBackup(process.argv[3])
} else {
  runServer()
}
