import { isNewer } from '../../server/src/protocol.ts'
import type { RecordKind, SyncRecord } from '../../server/src/protocol.ts'
import type { Checkin, SyncedRecord, Task, TimeEntry, WorkbenchState } from '../types'

// 纯函数：只用 `import type` 和带 .ts 后缀的导入，node --test 可以直接加载。

type Collection = 'tasks' | 'timeEntries' | 'checkins'

const COLLECTIONS: Record<RecordKind, Collection> = {
  task: 'tasks',
  timeEntry: 'timeEntries',
  checkin: 'checkins',
}

/** 推送水位线往前多推一段，系统时间被往回调了一点也不会漏推；重复推送是无害的。 */
export const PUSH_OVERLAP_MS = 60_000

/** 一次同步要删除的本机可见记录超过这个数时，先让用户确认。 */
export const MASS_DELETE_THRESHOLD = 20

type AnyRecord = (Task | TimeEntry | Checkin) & SyncedRecord & { id: string }

function toSyncRecord(kind: RecordKind, record: AnyRecord): SyncRecord {
  return {
    kind,
    id: record.id,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    data: record as unknown as Record<string, unknown>,
  }
}

/**
 * 本机需要推送的记录：修改时间不早于（水位线 − 重叠时间）的所有记录，包括墓碑。
 * 从没同步过（水位线为空）时推送全部。
 */
export function collectChanges(store: WorkbenchState, pushedUntil: string | null): SyncRecord[] {
  const since = pushedUntil ? Date.parse(pushedUntil) - PUSH_OVERLAP_MS : Number.NEGATIVE_INFINITY
  const changes: SyncRecord[] = []
  for (const kind of Object.keys(COLLECTIONS) as RecordKind[]) {
    for (const record of store[COLLECTIONS[kind]] as AnyRecord[]) {
      if (Date.parse(record.updatedAt) >= since) changes.push(toSyncRecord(kind, record))
    }
  }
  return changes
}

/** 远端记录写回本地时，以外层的 updatedAt / deletedAt 为准。 */
function fromSyncRecord(remote: SyncRecord): AnyRecord {
  return { ...remote.data, updatedAt: remote.updatedAt, deletedAt: remote.deletedAt } as unknown as AnyRecord
}

export interface MergeResult {
  store: WorkbenchState
  /** 实际写进本地的记录数（远端比本地新的那些）。 */
  applied: number
  /** 这批记录会删掉多少条本机当前可见的记录。 */
  removesVisible: number
}

/**
 * 把服务器返回的记录合并进本地：按 id 对齐，远端更新才覆盖（和服务端同一条规则）。
 * 没有任何变化时返回原来的 store 对象，调用方据此避免触发无意义的保存和再次同步。
 */
export function mergeRemote(store: WorkbenchState, remote: SyncRecord[]): MergeResult {
  let applied = 0
  let removesVisible = 0
  const next: Pick<WorkbenchState, Collection> = {
    tasks: store.tasks,
    timeEntries: store.timeEntries,
    checkins: store.checkins,
  }

  const grouped = new Map<Collection, SyncRecord[]>()
  for (const record of remote) {
    const collection = COLLECTIONS[record.kind]
    grouped.set(collection, [...(grouped.get(collection) ?? []), record])
  }

  for (const [collection, records] of grouped) {
    const current = next[collection] as AnyRecord[]
    const index = new Map(current.map((record, position) => [record.id, position]))
    const updated = [...current]
    let changed = false

    for (const incoming of records) {
      const position = index.get(incoming.id)
      const local = position === undefined ? undefined : updated[position]
      if (local && !isNewer(incoming, toSyncRecord(incoming.kind, local))) continue

      if (local && local.deletedAt === null && incoming.deletedAt !== null) removesVisible += 1
      const merged = fromSyncRecord(incoming)
      if (position === undefined) {
        index.set(incoming.id, updated.length)
        updated.push(merged)
      } else {
        updated[position] = merged
      }
      applied += 1
      changed = true
    }

    if (changed) (next as Record<Collection, AnyRecord[]>)[collection] = updated
  }

  if (applied === 0) return { store, applied, removesVisible }
  return { store: { ...store, ...next }, applied, removesVisible }
}

/** 只统计、不合并：用来在真正删除之前先问用户。 */
export function countVisibleRemovals(store: WorkbenchState, remote: SyncRecord[]): number {
  return mergeRemote(store, remote).removesVisible
}
