import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { repairInvariants } from './invariants.ts'
import { isNewer, MAX_PULL_PER_RESPONSE } from './protocol.ts'
import type { RecordKind, SyncRecord } from './protocol.ts'

interface RecordRow {
  kind: string
  id: string
  updated_at: string
  deleted_at: string | null
  data: string
  seq: number
}

export interface ApplyResult {
  accepted: number
  rejected: number
  repaired: number
}

export interface PullResult {
  cursor: number
  changes: SyncRecord[]
  more: boolean
}

function toRecord(row: RecordRow): SyncRecord {
  return {
    kind: row.kind as RecordKind,
    id: row.id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    data: JSON.parse(row.data) as Record<string, unknown>,
  }
}

/**
 * 服务器上的记录库。每条被接受的写入都分配一个递增的 seq，客户端靠 seq 判断“什么变了”，
 * 不依赖任何一台设备的时钟；时钟只用来在冲突时决定谁胜出（见 protocol.ts 的 compareRecords）。
 */
export class SyncStore {
  readonly serverId: string
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        data TEXT NOT NULL,
        seq INTEGER NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS records_seq ON records (seq);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    const existing = this.db.prepare("SELECT value FROM meta WHERE key = 'server_id'").get() as
      | { value: string }
      | undefined
    if (existing) {
      this.serverId = existing.value
    } else {
      this.serverId = randomUUID()
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('server_id', ?)").run(this.serverId)
    }
  }

  maxSeq(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM records').get() as {
      seq: number
    }
    return row.seq
  }

  get(kind: RecordKind, id: string): SyncRecord | null {
    const row = this.db
      .prepare('SELECT kind, id, updated_at, deleted_at, data, seq FROM records WHERE kind = ? AND id = ?')
      .get(kind, id) as RecordRow | undefined
    return row ? toRecord(row) : null
  }

  /** 所有未删除的同类记录，给不变量修复用。 */
  live(kind: RecordKind): SyncRecord[] {
    const rows = this.db
      .prepare(
        'SELECT kind, id, updated_at, deleted_at, data, seq FROM records WHERE kind = ? AND deleted_at IS NULL',
      )
      .all(kind) as unknown as RecordRow[]
    return rows.map(toRecord)
  }

  private upsert(record: SyncRecord, seq: number): void {
    this.db
      .prepare(
        `INSERT INTO records (kind, id, updated_at, deleted_at, data, seq)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (kind, id) DO UPDATE SET
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           data = excluded.data,
           seq = excluded.seq`,
      )
      .run(record.kind, record.id, record.updatedAt, record.deletedAt, JSON.stringify(record.data), seq)
  }

  /**
   * 在一个事务里写入客户端推上来的改动：比服务器上已有的版本新才接受。
   * 写完后修复“同时只能有一段进行中的打卡/专注计时”这类约定，修复结果也分配新 seq，
   * 所以每台设备下一次同步都会拿到同一个修复结果。
   */
  apply(changes: SyncRecord[], now: Date = new Date()): ApplyResult {
    let seq = this.maxSeq()
    let accepted = 0
    let rejected = 0
    let repaired = 0

    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const change of changes) {
        const existing = this.get(change.kind, change.id)
        if (existing && !isNewer(change, existing)) {
          rejected += 1
          continue
        }
        this.upsert(change, ++seq)
        accepted += 1
      }

      if (accepted > 0) {
        for (const fixed of repairInvariants(this, now)) {
          this.upsert(fixed, ++seq)
          repaired += 1
        }
      }

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return { accepted, rejected, repaired }
  }

  /**
   * 返回 seq 大于 cursor 的记录。客户端的 cursor 比服务器最大序号还大，说明服务器数据被重建过，
   * 从头返回（客户端同时会发现 serverId 变了并重新全量推送）。
   */
  pull(cursor: number, limit: number = MAX_PULL_PER_RESPONSE): PullResult {
    const from = cursor > this.maxSeq() ? 0 : cursor
    const rows = this.db
      .prepare(
        'SELECT kind, id, updated_at, deleted_at, data, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?',
      )
      .all(from, limit + 1) as unknown as RecordRow[]

    const more = rows.length > limit
    const page = more ? rows.slice(0, limit) : rows
    return {
      cursor: page.length > 0 ? page[page.length - 1].seq : from,
      changes: page.map(toRecord),
      more,
    }
  }

  /** 一致的在线备份（WAL 模式下直接复制文件可能漏掉未合并的数据）。 */
  backupTo(path: string): void {
    this.db.prepare('VACUUM INTO ?').run(path)
  }

  close(): void {
    this.db.close()
  }
}
