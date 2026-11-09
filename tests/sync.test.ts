import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { createSyncHandler, RateLimiter } from '../server/src/app.ts'
import type { SyncRequest } from '../server/src/protocol.ts'
import { SyncStore } from '../server/src/store.ts'
import { emptySyncMeta, liveView, tombstone } from '../src/data/records.ts'
import { collectChanges, mergeRemote } from '../src/sync/merge.ts'
import { runSync } from '../src/sync/engine.ts'
import type { SyncOutcome } from '../src/sync/engine.ts'
import type { Checkin, Task, WorkbenchState } from '../src/types'

// 两台“Mac”运行真实的同步引擎，通过 HTTP 连接真实的服务端处理函数和存储。

const TOKEN = 'e2e-token-0123456789abcdefghijklmnopqrstuvwxyz'

let dir: string
let server: Server
let store: SyncStore
let base: string

async function startServer(dbFile: string) {
  store = new SyncStore(join(dir, dbFile))
  const limiter = new RateLimiter({ maxRequestsPerMinute: 100_000 })
  server = createServer(createSyncHandler({ store, token: TOKEN, limiter, log: () => undefined }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function stopServer() {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  store.close()
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sync-e2e-'))
  await startServer('sync.sqlite3')
})

afterEach(async () => {
  await stopServer()
  rmSync(dir, { recursive: true, force: true })
})

class Device {
  data: WorkbenchState
  clock = new Date('2026-11-01T00:00:00.000Z')
  confirmAnswer = true
  confirmedWith: number[] = []

  constructor(id: string) {
    this.data = { tasks: [], timeEntries: [], checkins: [], lastOpenedResourceId: null, sync: { ...emptySyncMeta(), deviceId: id } }
  }

  tick(minutes = 1): string {
    this.clock = new Date(this.clock.getTime() + minutes * 60_000)
    return this.clock.toISOString()
  }

  edit(fn: (data: WorkbenchState, at: string) => WorkbenchState) {
    this.data = fn(this.data, this.tick())
  }

  sync(): Promise<SyncOutcome> {
    return runSync({
      exchange: async (request: SyncRequest) => {
        const response = await fetch(`${base}/v1/sync`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
        const body = await response.json()
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`)
        return body
      },
      getStore: () => this.data,
      update: (updater) => {
        this.data = updater(this.data)
      },
      confirmRemovals: (count) => {
        this.confirmedWith.push(count)
        return this.confirmAnswer
      },
      now: () => this.clock,
    })
  }

  live() {
    return liveView(this.data)
  }
}

function newTask(id: string, title: string, at: string): Task {
  return {
    id, title, description: '', dueAt: null, priority: 'medium', status: 'todo', resources: [],
    createdAt: at, updatedAt: at, deletedAt: null, completedAt: null,
  }
}

function newCheckin(id: string, clockInAt: string, clockOutAt: string | null, at: string): Checkin {
  return { id, date: clockInAt.slice(0, 10), clockInAt, clockOutAt, note: '', updatedAt: at, deletedAt: null }
}

function setTitle(id: string, title: string) {
  return (data: WorkbenchState, at: string): WorkbenchState => ({
    ...data,
    tasks: data.tasks.map((task) => (task.id === id ? { ...task, title, updatedAt: at } : task)),
  })
}

test('一台设备的记录同步到另一台', async () => {
  const a = new Device('mac-a')
  const b = new Device('mac-b')
  a.edit((d, at) => ({ ...d, tasks: [newTask('t1', '写周报', at)], checkins: [newCheckin('c1', '2026-11-01T01:00:00.000Z', '2026-11-01T09:00:00.000Z', at)] }))

  assert.deepEqual(await a.sync(), { status: 'ok', pushed: 2, pulled: 2 })
  await b.sync()
  assert.deepEqual(b.live().tasks.map((t) => t.title), ['写周报'])
  assert.equal(b.live().checkins.length, 1)
  assert.equal(b.data.sync.serverId, store.serverId)
})

test('两边离线各改了同一个任务：更晚的修改在两台设备上都胜出', async () => {
  const a = new Device('mac-a')
  const b = new Device('mac-b')
  a.edit((d, at) => ({ ...d, tasks: [newTask('t1', '原标题', at)] }))
  await a.sync()
  await b.sync()

  a.edit(setTitle('t1', 'A 的修改'))       // A 先改
  b.tick(5)
  b.edit(setTitle('t1', 'B 的修改（更晚）')) // B 后改
  await a.sync()
  await b.sync()
  await a.sync()

  assert.equal(a.live().tasks[0].title, 'B 的修改（更晚）')
  assert.equal(b.live().tasks[0].title, 'B 的修改（更晚）')
})

test('删除会同步到其他设备，并且不会被另一台设备的旧版本“复活”', async () => {
  const a = new Device('mac-a')
  const b = new Device('mac-b')
  a.edit((d, at) => ({ ...d, tasks: [newTask('t1', '要删的任务', at)] }))
  await a.sync()
  await b.sync()

  a.edit((d, at) => ({ ...d, tasks: d.tasks.map((t) => tombstone(t, at)) }))
  await a.sync()
  await b.sync()
  assert.equal(b.live().tasks.length, 0)

  // B 再同步、A 再同步：墓碑保持，旧版本不会回来
  await b.sync()
  await a.sync()
  assert.equal(a.live().tasks.length, 0)
  assert.equal(a.data.tasks.length, 1, '墓碑仍保留在完整数据里')
})

test('两台设备各打了一次上班卡：同步后两边只剩同一段进行中的打卡', async () => {
  const a = new Device('mac-a')
  const b = new Device('mac-b')
  a.edit((d, at) => ({ ...d, checkins: [newCheckin('a-in', '2026-11-01T01:00:00.000Z', null, at)] }))
  b.tick(30)
  b.edit((d, at) => ({ ...d, checkins: [newCheckin('b-in', '2026-11-01T01:30:00.000Z', null, at)] }))

  await a.sync()
  await b.sync()
  await a.sync()

  for (const device of [a, b]) {
    const open = device.live().checkins.filter((c) => c.clockOutAt === null)
    assert.deepEqual(open.map((c) => c.id), ['b-in'], `${device.data.sync.deviceId} 只剩较晚那段`)
    const closed = device.live().checkins.find((c) => c.id === 'a-in')
    assert.equal(closed?.clockOutAt, '2026-11-01T01:30:00.000Z')
  }
})

test('一次同步要删除很多条记录时先询问；拒绝后不删除、游标不前进，同意后再删', async () => {
  const a = new Device('mac-a')
  const b = new Device('mac-b')
  a.edit((d, at) => ({ ...d, tasks: Array.from({ length: 25 }, (_, i) => newTask(`t${i}`, `任务 ${i}`, at)) }))
  await a.sync()
  await b.sync()
  const cursorBefore = b.data.sync.cursor

  a.edit((d, at) => ({ ...d, tasks: d.tasks.map((t) => tombstone(t, at)) }))
  await a.sync()

  b.confirmAnswer = false
  assert.deepEqual(await b.sync(), { status: 'paused', pendingRemovals: 25 })
  assert.equal(b.live().tasks.length, 25, '拒绝后一条都不删')
  assert.equal(b.data.sync.cursor, cursorBefore, '游标没有前进，下次还会再问')

  b.confirmAnswer = true
  assert.equal((await b.sync()).status, 'ok')
  assert.equal(b.live().tasks.length, 0)
  assert.deepEqual(b.confirmedWith, [25, 25])
})

test('少量删除不打扰用户', async () => {
  const a = new Device('mac-a')
  const b = new Device('mac-b')
  a.edit((d, at) => ({ ...d, tasks: Array.from({ length: 5 }, (_, i) => newTask(`t${i}`, `任务 ${i}`, at)) }))
  await a.sync()
  await b.sync()
  a.edit((d, at) => ({ ...d, tasks: d.tasks.map((t) => tombstone(t, at)) }))
  await a.sync()
  await b.sync()
  assert.deepEqual(b.confirmedWith, [])
  assert.equal(b.live().tasks.length, 0)
})

test('服务器数据被重建后，客户端发现 serverId 变了，自动全量重新推送', async () => {
  const b = new Device('mac-b')
  b.edit((d, at) => ({ ...d, tasks: [newTask('old', '很早以前的任务', at)] }))
  await b.sync()
  const oldServerId = store.serverId

  // 换一个全新的数据库（模拟服务器重装、数据丢失）
  await stopServer()
  await startServer('rebuilt.sqlite3')
  assert.notEqual(store.serverId, oldServerId)

  b.tick(10)
  const outcome = await b.sync()
  assert.equal(outcome.status, 'ok')
  assert.equal(store.get('task', 'old')?.data.title, '很早以前的任务', '旧记录重新推送到新服务器')
  assert.equal(b.data.sync.serverId, store.serverId)
})

test('水位线之后只推送新改动；没有新内容的同步不改动本地数据', async () => {
  const a = new Device('mac-a')
  a.edit((d, at) => ({ ...d, tasks: [newTask('t1', '一', at), newTask('t2', '二', at)] }))
  // 让这两条记录早于水位线前的重叠窗口（PUSH_OVERLAP_MS），否则按设计会被再推一次
  a.tick(5)
  await a.sync()

  a.tick(10)
  a.edit(setTitle('t1', '一（改）'))
  assert.equal(collectChanges(a.data, a.data.sync.pushedUntil).length, 1)
  assert.equal((await a.sync()).status, 'ok')

  a.tick(10)
  const before = a.data.tasks
  await a.sync()
  assert.equal(a.data.tasks, before, '数据对象没变，不会触发保存和下一轮同步')
})

test('记录多于一次推送/拉取的上限时分批完成', async () => {
  const a = new Device('mac-a')
  const b = new Device('mac-b')
  a.edit((d, at) => ({ ...d, tasks: Array.from({ length: 1234 }, (_, i) => newTask(`t${i}`, `任务 ${i}`, at)) }))
  assert.deepEqual(await a.sync(), { status: 'ok', pushed: 1234, pulled: 1234 })
  await b.sync()
  assert.equal(b.live().tasks.length, 1234)
})

test('服务器返回格式不正确的记录时整批拒绝，本地数据不变', async () => {
  const a = new Device('mac-a')
  const before = a.data
  await assert.rejects(
    runSync({
      exchange: async () => ({ protocol: 1, serverId: 's', cursor: 1, more: false, serverTime: '', changes: [{ kind: 'task', id: 'x' }] }),
      getStore: () => a.data,
      update: (updater) => { a.data = updater(a.data) },
      confirmRemovals: () => true,
    }),
    /格式不正确/,
  )
  assert.equal(a.data, before)
})

test('mergeRemote：远端不比本地新时保持原对象', () => {
  const a = new Device('mac-a')
  a.edit((d, at) => ({ ...d, tasks: [newTask('t1', '本地', at)] }))
  const stale = { kind: 'task' as const, id: 't1', updatedAt: '2020-01-01T00:00:00.000Z', deletedAt: null, data: { id: 't1', title: '旧' } }
  const result = mergeRemote(a.data, [stale])
  assert.equal(result.applied, 0)
  assert.equal(result.store, a.data)
})
