import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { SyncStore } from '../src/store.ts'
import type { SyncRecord } from '../src/protocol.ts'

let dir: string
let store: SyncStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-store-'))
  store = new SyncStore(join(dir, 'sync.sqlite3'))
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

function task(id: string, updatedAt: string, title = id, deletedAt: string | null = null): SyncRecord {
  return { kind: 'task', id, updatedAt, deletedAt, data: { id, title, updatedAt, deletedAt } }
}

function checkin(id: string, clockInAt: string, clockOutAt: string | null, updatedAt = clockInAt): SyncRecord {
  return {
    kind: 'checkin',
    id,
    updatedAt,
    deletedAt: null,
    data: { id, clockInAt, clockOutAt, updatedAt, deletedAt: null },
  }
}

test('新记录被接受，并按写入顺序分配递增的序号', () => {
  const result = store.apply([task('a', '2026-10-01T00:00:00.000Z'), task('b', '2026-10-01T00:00:01.000Z')])
  assert.deepEqual(result, { accepted: 2, rejected: 0, repaired: 0 })
  const pulled = store.pull(0)
  assert.deepEqual(pulled.changes.map((r) => r.id), ['a', 'b'])
  assert.equal(pulled.cursor, 2)
  assert.equal(pulled.more, false)
})

test('更旧或相同的版本被拒绝，不会覆盖服务器上的新版本', () => {
  store.apply([task('a', '2026-10-02T00:00:00.000Z', '新标题')])
  const result = store.apply([task('a', '2026-10-01T00:00:00.000Z', '旧标题'), task('a', '2026-10-02T00:00:00.000Z', '新标题')])
  assert.deepEqual(result, { accepted: 0, rejected: 2, repaired: 0 })
  assert.equal(store.get('task', 'a')?.data.title, '新标题')
  assert.equal(store.maxSeq(), 1, '被拒绝的写入不分配序号')
})

test('更晚的删除覆盖修改，拉取时带着墓碑', () => {
  store.apply([task('a', '2026-10-01T00:00:00.000Z')])
  store.apply([task('a', '2026-10-03T00:00:00.000Z', 'a', '2026-10-03T00:00:00.000Z')])
  const pulled = store.pull(1)
  assert.equal(pulled.changes.length, 1)
  assert.equal(pulled.changes[0].deletedAt, '2026-10-03T00:00:00.000Z')
})

test('只返回游标之后的记录；数据多时分页返回', () => {
  store.apply(Array.from({ length: 5 }, (_, i) => task(`t${i}`, `2026-10-01T00:00:0${i}.000Z`)))
  const first = store.pull(0, 2)
  assert.deepEqual([first.changes.map((r) => r.id), first.cursor, first.more], [['t0', 't1'], 2, true])
  const second = store.pull(first.cursor, 2)
  assert.deepEqual([second.changes.map((r) => r.id), second.cursor, second.more], [['t2', 't3'], 4, true])
  const last = store.pull(second.cursor, 2)
  assert.deepEqual([last.changes.map((r) => r.id), last.cursor, last.more], [['t4'], 5, false])
  const empty = store.pull(last.cursor, 2)
  assert.deepEqual([empty.changes.length, empty.cursor, empty.more], [0, 5, false])
})

test('客户端游标比服务器还大（服务器数据被重建）时从头返回', () => {
  store.apply([task('a', '2026-10-01T00:00:00.000Z')])
  const pulled = store.pull(999)
  assert.deepEqual(pulled.changes.map((r) => r.id), ['a'])
})

test('serverId 在重新打开数据库后保持不变，新建的库则不同', () => {
  const id = store.serverId
  store.close()
  store = new SyncStore(join(dir, 'sync.sqlite3'))
  assert.equal(store.serverId, id)
  const other = new SyncStore(join(dir, 'other.sqlite3'))
  assert.notEqual(other.serverId, id)
  other.close()
})

test('两台设备各打了一次上班卡：保留最晚的一段，较早那段在它开始时结束', () => {
  const now = new Date('2026-10-05T12:00:00.000Z')
  store.apply([checkin('mac-a', '2026-10-05T01:00:00.000Z', null)], now)
  const result = store.apply([checkin('mac-b', '2026-10-05T02:00:00.000Z', null)], now)
  assert.equal(result.repaired, 1)

  const a = store.get('checkin', 'mac-a')!
  const b = store.get('checkin', 'mac-b')!
  assert.equal(a.data.clockOutAt, '2026-10-05T02:00:00.000Z')
  assert.equal(b.data.clockOutAt, null)
  assert.equal(a.updatedAt, now.toISOString())
  assert.equal(a.data.updatedAt, a.updatedAt, 'data 里的 updatedAt 同步更新')

  // 修复结果分配了新序号，所有设备都会拉到
  assert.deepEqual(store.pull(2).changes.map((r) => r.id), ['mac-a'])
})

test('修复时间晚于所有相关记录：时钟偏快的设备不会把“进行中”的旧版本覆盖回去', () => {
  const serverNow = new Date('2026-10-05T12:00:00.000Z')
  const future = '2026-10-05T12:30:00.000Z' // 这台设备的时钟快了半小时
  store.apply([checkin('mac-a', '2026-10-05T01:00:00.000Z', null, future)], serverNow)
  store.apply([checkin('mac-b', '2026-10-05T02:00:00.000Z', null)], serverNow)

  const repaired = store.get('checkin', 'mac-a')!
  assert.ok(Date.parse(repaired.updatedAt) > Date.parse(future))
  const again = store.apply([checkin('mac-a', '2026-10-05T01:00:00.000Z', null, future)], serverNow)
  assert.equal(again.accepted, 0, '旧的“进行中”版本推不回去')
})

test('只有一段进行中的打卡时不做修复；已删除的进行中记录不参与', () => {
  store.apply([checkin('a', '2026-10-05T01:00:00.000Z', '2026-10-05T05:00:00.000Z'), checkin('b', '2026-10-05T06:00:00.000Z', null)])
  const deletedOpen: SyncRecord = { ...checkin('c', '2026-10-05T07:00:00.000Z', null), deletedAt: '2026-10-05T07:10:00.000Z', updatedAt: '2026-10-05T07:10:00.000Z' }
  const result = store.apply([deletedOpen])
  assert.equal(result.repaired, 0)
  assert.equal(store.get('checkin', 'b')?.data.clockOutAt, null)
})

test('两段进行中的专注计时同样修复，非专注类型和已结束的不受影响', () => {
  const entry = (id: string, startedAt: string, type = 'focus'): SyncRecord => ({
    kind: 'timeEntry',
    id,
    updatedAt: startedAt,
    deletedAt: null,
    data: { id, type, startedAt, endedAt: null, updatedAt: startedAt, deletedAt: null },
  })
  store.apply([entry('f1', '2026-10-05T01:00:00.000Z'), entry('f2', '2026-10-05T02:00:00.000Z'), entry('other', '2026-10-05T00:30:00.000Z', 'checkin')])
  assert.equal(store.get('timeEntry', 'f1')?.data.endedAt, '2026-10-05T02:00:00.000Z')
  assert.equal(store.get('timeEntry', 'f2')?.data.endedAt, null)
  assert.equal(store.get('timeEntry', 'other')?.data.endedAt, null)
})

test('backupTo 生成一份可以打开的完整副本', () => {
  store.apply([task('a', '2026-10-01T00:00:00.000Z')])
  const target = join(dir, 'backup.sqlite3')
  store.backupTo(target)
  const copy = new SyncStore(target)
  assert.equal(copy.get('task', 'a')?.id, 'a')
  assert.equal(copy.serverId, store.serverId)
  copy.close()
})
