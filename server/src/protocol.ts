/**
 * 同步协议：服务端和客户端共用这一份文件（客户端从 src/ 直接导入）。
 *
 * 只用可被擦除的 TypeScript 语法（不用 enum / namespace / 参数属性），
 * Node 24 可以直接运行，前端由 Vite 打包，两边都不需要额外编译。
 */

export const PROTOCOL_VERSION = 1

export const RECORD_KINDS = ['task', 'timeEntry', 'checkin'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

/** 一条参与同步的记录。data 是完整记录本身，updatedAt / deletedAt 单独提出来便于比较。 */
export interface SyncRecord {
  kind: RecordKind
  id: string
  updatedAt: string
  deletedAt: string | null
  data: Record<string, unknown>
}

export interface SyncRequest {
  protocol: number
  /** 客户端已经拿到的最大序号，第一次同步传 0。 */
  cursor: number
  /** 本机自上次同步以来改动过的记录。 */
  changes: SyncRecord[]
}

export interface SyncResponse {
  protocol: number
  /**
   * 服务器数据库的随机 id，建库时生成。客户端发现它变了（服务器数据被重建），
   * 要清空游标和推送水位线，重新全量推送和拉取，否则本机旧记录再也不会被上传。
   */
  serverId: string
  /** 这次返回的最后一条记录的序号，下次请求带上它。 */
  cursor: number
  /** 序号大于请求 cursor 的记录（包括刚推上去被接受的那些，客户端重复合并是无害的）。 */
  changes: SyncRecord[]
  /** 还有更多记录没返回完，客户端应立即用新的 cursor 再请求一次。 */
  more: boolean
  serverTime: string
}

export interface PingResponse {
  protocol: number
  serverId: string
  serverTime: string
}

export const MAX_PUSH_PER_REQUEST = 500
export const MAX_PULL_PER_RESPONSE = 1000
export const MAX_ID_LENGTH = 128
export const MAX_RECORD_BYTES = 64 * 1024

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 键按字典序排列的 JSON，同样的内容在任何一端都得到同一个字符串。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

type Comparable = Pick<SyncRecord, 'updatedAt' | 'deletedAt' | 'data'>

/**
 * 冲突规则：updatedAt 更晚的记录胜出（删除也是一次修改，比较时同等对待）。
 * 时间完全相同时按内容的规范化 JSON 比较，只是为了让每一端都选出同一个胜者。
 * a 比 b 新返回正数，相同返回 0。
 */
export function compareRecords(a: Comparable, b: Comparable): number {
  const timeA = Date.parse(a.updatedAt)
  const timeB = Date.parse(b.updatedAt)
  if (timeA !== timeB) return timeA - timeB

  const contentA = canonicalJson({ deletedAt: a.deletedAt, data: a.data })
  const contentB = canonicalJson({ deletedAt: b.deletedAt, data: b.data })
  if (contentA === contentB) return 0
  return contentA > contentB ? 1 : -1
}

export function isNewer(incoming: Comparable, existing: Comparable): boolean {
  return compareRecords(incoming, existing) > 0
}

/**
 * 校验一条来自网络的记录。不合法返回 null：服务端用来拒绝坏数据，
 * 客户端用来防止服务器返回的异常内容写进本地。
 */
export function parseSyncRecord(value: unknown): SyncRecord | null {
  if (!isPlainObject(value)) return null
  const { kind, id, updatedAt, deletedAt, data } = value

  if (typeof kind !== 'string' || !(RECORD_KINDS as readonly string[]).includes(kind)) return null
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return null
  if (!isIsoTimestamp(updatedAt)) return null
  if (deletedAt !== null && !isIsoTimestamp(deletedAt)) return null
  if (!isPlainObject(data) || data.id !== id) return null
  if (canonicalJson(data).length > MAX_RECORD_BYTES) return null

  return { kind: kind as RecordKind, id, updatedAt, deletedAt, data }
}
