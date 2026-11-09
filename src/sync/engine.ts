import { MAX_PUSH_PER_REQUEST, parseSyncRecord, PROTOCOL_VERSION } from '../../server/src/protocol.ts'
import type { SyncRecord, SyncRequest, SyncResponse } from '../../server/src/protocol.ts'
import type { WorkbenchState } from '../types'
import { collectChanges, countVisibleRemovals, MASS_DELETE_THRESHOLD, mergeRemote } from './merge.ts'

// 和 merge.ts 一样只依赖纯函数，传输、存储和询问用户都由调用方注入，方便测试。

export interface SyncDeps {
  /** 把请求发给服务器，返回解析好的 JSON（桌面端经由 Rust 转发）。 */
  exchange(request: SyncRequest): Promise<unknown>
  /** 当前完整的本地数据（含墓碑）。 */
  getStore(): WorkbenchState
  /** 在最新的本地数据上应用一次更新。 */
  update(updater: (store: WorkbenchState) => WorkbenchState): void
  /** 一次同步要删除很多条本机记录时询问用户；返回 false 表示这次先不删。 */
  confirmRemovals(count: number): boolean | Promise<boolean>
  now?(): Date
}

export type SyncOutcome =
  | { status: 'ok'; pushed: number; pulled: number }
  | { status: 'paused'; pendingRemovals: number }

/** 防止服务器异常（例如一直返回 more: true）时陷入死循环。 */
const MAX_ROUNDS = 500

function parseResponse(value: unknown): { response: SyncResponse; records: SyncRecord[] } {
  if (typeof value !== 'object' || value === null) throw new Error('服务器返回的内容无法识别')
  const response = value as SyncResponse

  if (response.protocol !== PROTOCOL_VERSION) {
    throw new Error('客户端和服务器的同步协议版本不一致，请把两边升级到同一版本')
  }
  if (typeof response.serverId !== 'string' || response.serverId.length === 0) {
    throw new Error('服务器没有返回 serverId')
  }
  if (!Number.isSafeInteger(response.cursor) || response.cursor < 0) {
    throw new Error('服务器返回的游标不正确')
  }
  if (!Array.isArray(response.changes) || typeof response.more !== 'boolean') {
    throw new Error('服务器返回的内容格式不正确')
  }

  // 任何一条不合法就整批拒绝，不把半份可疑数据写进本地
  const records = response.changes.map((change) => parseSyncRecord(change))
  if (records.some((record) => record === null)) throw new Error('服务器返回了格式不正确的记录')
  return { response, records: records as SyncRecord[] }
}

/**
 * 一次完整的同步：推送本机改动、拉取并合并其他设备的改动，直到双方都没有剩余。
 *
 * - 推送分批，每批和拉取在同一个请求里完成。
 * - 合并结果和新游标在同一次更新里写入，持久化时在同一个事务里落盘。
 * - 推送水位线只在全部完成后前进；中途失败下次会重推，服务器按同一规则去重，重复推送无害。
 * - 服务器的 serverId 变了（数据被重建），清空游标和水位线后全量重来一次。
 */
export function runSync(deps: SyncDeps): Promise<SyncOutcome> {
  return syncFrom(deps, false)
}

/**
 * fromScratch 为 true 时忽略本地保存的游标、水位线和 serverId，全量推送和拉取。
 * 不能靠先 update 再读 getStore 来实现：React 里 update 要等下一次渲染才生效。
 */
async function syncFrom(deps: SyncDeps, fromScratch: boolean): Promise<SyncOutcome> {
  const now = deps.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const saved = deps.getStore().sync
  const pushedUntil = fromScratch ? null : saved.pushedUntil
  const knownServerId = fromScratch ? null : saved.serverId

  const pending = collectChanges(deps.getStore(), pushedUntil)
  const pushed = pending.length
  let cursor = fromScratch ? 0 : (saved.cursor ?? 0)
  let removals = 0
  let removalsApproved = false
  let pulled = 0

  for (let round = 0; ; round += 1) {
    if (round >= MAX_ROUNDS) throw new Error('同步请求次数过多，已中止，请稍后重试')

    const batch = pending.splice(0, MAX_PUSH_PER_REQUEST)
    const { response, records } = parseResponse(
      await deps.exchange({ protocol: PROTOCOL_VERSION, cursor, changes: batch }),
    )

    if (knownServerId !== null && response.serverId !== knownServerId) {
      // 服务器数据被重建过：本机记录要全部重新推送，否则那些更早的改动再也不会上传
      if (fromScratch) throw new Error('服务器数据在同步过程中发生了变化，请重试')
      return syncFrom(deps, true)
    }

    if (!removalsApproved) {
      removals += countVisibleRemovals(deps.getStore(), records)
      if (removals > MASS_DELETE_THRESHOLD) {
        if (!(await deps.confirmRemovals(removals))) {
          return { status: 'paused', pendingRemovals: removals }
        }
        removalsApproved = true
      }
    }

    deps.update((store) => {
      const merged = mergeRemote(store, records)
      return {
        ...merged.store,
        sync: { ...merged.store.sync, cursor: response.cursor, serverId: response.serverId },
      }
    })

    cursor = response.cursor
    pulled += records.length
    if (!response.more && pending.length === 0) break
  }

  deps.update((store) => ({
    ...store,
    sync: { ...store.sync, pushedUntil: startedAt, lastSyncAt: now().toISOString() },
  }))
  return { status: 'ok', pushed, pulled }
}
