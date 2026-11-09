import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { createSyncHandler, RateLimiter } from '../src/app.ts'
import { PROTOCOL_VERSION, MAX_PUSH_PER_REQUEST } from '../src/protocol.ts'
import type { SyncRecord } from '../src/protocol.ts'
import { SyncStore } from '../src/store.ts'

// 处理函数和 TLS 无关，这里用普通 HTTP 测试；main.ts 只用 HTTPS 启动它
const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz'

let dir: string
let store: SyncStore
let server: Server
let base: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sync-app-'))
  store = new SyncStore(join(dir, 'sync.sqlite3'))
  const limiter = new RateLimiter({ maxFailures: 3, maxRequestsPerMinute: 50 })
  server = createServer(createSyncHandler({ store, token: TOKEN, limiter, log: () => undefined }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

function sync(body: unknown, token = TOKEN) {
  return fetch(`${base}/v1/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function task(id: string, updatedAt = '2026-10-01T00:00:00.000Z'): SyncRecord {
  return { kind: 'task', id, updatedAt, deletedAt: null, data: { id, title: id, updatedAt, deletedAt: null } }
}

test('ping 需要令牌，返回协议版本、serverId 和服务器时间', async () => {
  assert.equal((await fetch(`${base}/v1/ping`)).status, 401)
  const response = await fetch(`${base}/v1/ping`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  assert.equal(response.status, 200)
  const body = (await response.json()) as Record<string, unknown>
  assert.equal(body.protocol, PROTOCOL_VERSION)
  assert.equal(body.serverId, store.serverId)
  assert.ok(typeof body.serverTime === 'string')
})

test('令牌错误返回 401；连续错误超过上限后整个 IP 被暂时拒绝（正确令牌也不行）', async () => {
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await sync({ protocol: PROTOCOL_VERSION, cursor: 0, changes: [] }, 'wrong')).status, 401)
  }
  const blocked = await sync({ protocol: PROTOCOL_VERSION, cursor: 0, changes: [] })
  assert.equal(blocked.status, 429)
})

test('推送后能拉回；第二台设备从游标 0 拉到全部记录', async () => {
  const pushed = await sync({ protocol: PROTOCOL_VERSION, cursor: 0, changes: [task('a'), task('b')] })
  assert.equal(pushed.status, 200)
  const first = (await pushed.json()) as Record<string, unknown>
  assert.equal(first.cursor, 2)
  assert.equal(first.serverId, store.serverId)

  const other = (await (await sync({ protocol: PROTOCOL_VERSION, cursor: 0, changes: [] })).json()) as {
    changes: SyncRecord[]
    cursor: number
  }
  assert.deepEqual(other.changes.map((r) => r.id).sort(), ['a', 'b'])

  const nothingNew = (await (await sync({ protocol: PROTOCOL_VERSION, cursor: other.cursor, changes: [] })).json()) as {
    changes: SyncRecord[]
  }
  assert.equal(nothingNew.changes.length, 0)
})

test('协议版本不一致返回 409，提示升级', async () => {
  const response = await sync({ protocol: PROTOCOL_VERSION + 1, cursor: 0, changes: [] })
  assert.equal(response.status, 409)
  assert.equal(((await response.json()) as Record<string, unknown>).error, 'protocol_mismatch')
})

test('请求格式错误分别返回 400 / 413，且一条坏记录会让整个请求被拒绝、什么都不写', async () => {
  assert.equal((await sync('not json')).status, 400)
  assert.equal((await sync({ protocol: PROTOCOL_VERSION, cursor: -1, changes: [] })).status, 400)
  assert.equal((await sync({ protocol: PROTOCOL_VERSION, cursor: 0, changes: 'x' })).status, 400)

  const tooMany = Array.from({ length: MAX_PUSH_PER_REQUEST + 1 }, (_, i) => task(`t${i}`))
  assert.equal((await sync({ protocol: PROTOCOL_VERSION, cursor: 0, changes: tooMany })).status, 413)

  const response = await sync({ protocol: PROTOCOL_VERSION, cursor: 0, changes: [task('ok'), { ...task('bad'), kind: 'nope' }] })
  assert.equal(response.status, 400)
  assert.equal(((await response.json()) as Record<string, unknown>).error, 'invalid_record')
  assert.equal(store.maxSeq(), 0, '整个请求都没有写入')
})

test('未知路径 404，方法不对 405', async () => {
  const headers = { Authorization: `Bearer ${TOKEN}` }
  assert.equal((await fetch(`${base}/v1/unknown`, { headers })).status, 404)
  assert.equal((await fetch(`${base}/v1/sync`, { headers })).status, 405)
  assert.equal((await fetch(`${base}/v1/ping`, { method: 'POST', headers })).status, 405)
})
