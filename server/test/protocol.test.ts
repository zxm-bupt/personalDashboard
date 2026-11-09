import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalJson, compareRecords, isNewer, parseSyncRecord } from '../src/protocol.ts'
import type { SyncRecord } from '../src/protocol.ts'

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  const id = overrides.id ?? 'c1'
  return {
    kind: 'checkin',
    id,
    updatedAt: '2026-10-01T10:00:00.000Z',
    deletedAt: null,
    data: { id, clockInAt: '2026-10-01T01:00:00.000Z', clockOutAt: null },
    ...overrides,
  }
}

test('canonicalJson 与键的顺序无关', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }))
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}')
})

test('修改时间更晚的记录胜出', () => {
  const older = record()
  const newer = record({ updatedAt: '2026-10-01T10:00:00.001Z' })
  assert.ok(isNewer(newer, older))
  assert.ok(!isNewer(older, newer))
})

test('删除和修改按同样的规则比较：更晚的删除会覆盖更早的修改，反之亦然', () => {
  const edit = record({ updatedAt: '2026-10-01T10:00:00.000Z' })
  const laterDelete = record({ updatedAt: '2026-10-01T11:00:00.000Z', deletedAt: '2026-10-01T11:00:00.000Z' })
  const earlierDelete = record({ updatedAt: '2026-10-01T09:00:00.000Z', deletedAt: '2026-10-01T09:00:00.000Z' })
  assert.ok(isNewer(laterDelete, edit))
  assert.ok(isNewer(edit, earlierDelete))
})

test('时间相同时按内容决出唯一胜者，结果对称且与比较顺序无关', () => {
  const a = record({ data: { id: 'c1', note: 'a' } })
  const b = record({ data: { id: 'c1', note: 'b' } })
  assert.equal(Math.sign(compareRecords(a, b)), -Math.sign(compareRecords(b, a)))
  assert.notEqual(compareRecords(a, b), 0)
  assert.equal(compareRecords(a, record({ data: { note: 'a', id: 'c1' } })), 0)
})

test('parseSyncRecord 接受合法记录', () => {
  assert.deepEqual(parseSyncRecord(record()), record())
})

test('parseSyncRecord 拒绝不合法的记录', () => {
  const bad: unknown[] = [
    null,
    [],
    { ...record(), kind: 'setting' },
    { ...record(), id: '' },
    { ...record(), id: 'x'.repeat(129) },
    { ...record(), updatedAt: '2026-10-01 10:00' },
    { ...record(), updatedAt: 'not a date' },
    { ...record(), deletedAt: 'yesterday' },
    { ...record(), data: [] },
    { ...record(), data: { id: 'other' } },
    { ...record(), data: { id: 'c1', blob: 'x'.repeat(70 * 1024) } },
  ]
  for (const value of bad) assert.equal(parseSyncRecord(value), null, JSON.stringify(value)?.slice(0, 80))
})
