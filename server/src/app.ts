import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  MAX_PUSH_PER_REQUEST,
  parseSyncRecord,
  PROTOCOL_VERSION,
} from './protocol.ts'
import type { PingResponse, SyncRecord, SyncResponse } from './protocol.ts'
import type { SyncStore } from './store.ts'

/** 单次请求体上限：500 条记录、每条最多 64KB，留足余量。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

interface Window {
  count: number
  resetAt: number
}

/**
 * 按来源 IP 计数的简单限流：令牌错误次数过多就暂时拒绝该 IP（防止暴力猜令牌），
 * 同时限制每分钟的总请求数。单进程、内存计数，个人服务器够用。
 */
export class RateLimiter {
  private readonly failures = new Map<string, Window>()
  private readonly requests = new Map<string, Window>()
  private readonly maxFailures: number
  private readonly failureWindowMs: number
  private readonly maxRequestsPerMinute: number

  constructor(options: { maxFailures?: number; failureWindowMs?: number; maxRequestsPerMinute?: number } = {}) {
    this.maxFailures = options.maxFailures ?? 10
    this.failureWindowMs = options.failureWindowMs ?? 15 * 60 * 1000
    this.maxRequestsPerMinute = options.maxRequestsPerMinute ?? 120
  }

  private bump(map: Map<string, Window>, key: string, windowMs: number, now: number): number {
    const current = map.get(key)
    if (!current || current.resetAt <= now) {
      map.set(key, { count: 1, resetAt: now + windowMs })
      return 1
    }
    current.count += 1
    return current.count
  }

  isBlocked(ip: string, now: number = Date.now()): boolean {
    const current = this.failures.get(ip)
    return Boolean(current && current.resetAt > now && current.count >= this.maxFailures)
  }

  recordFailure(ip: string, now: number = Date.now()): void {
    this.bump(this.failures, ip, this.failureWindowMs, now)
  }

  /** 返回 false 表示超过了每分钟请求上限。 */
  allowRequest(ip: string, now: number = Date.now()): boolean {
    if (this.requests.size > 10_000) this.prune(now)
    return this.bump(this.requests, ip, 60 * 1000, now) <= this.maxRequestsPerMinute
  }

  private prune(now: number): void {
    for (const map of [this.failures, this.requests]) {
      for (const [key, window] of map) {
        if (window.resetAt <= now) map.delete(key)
      }
    }
  }
}

/** 先各自取哈希再比较：长度固定，timingSafeEqual 才能用，也不会因为长度不同提前返回。 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match ? match[1] : null
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

function sendError(res: ServerResponse, status: number, error: string, message: string): void {
  sendJson(res, status, { error, message })
}

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError())
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export interface HandlerOptions {
  store: SyncStore
  token: string
  limiter?: RateLimiter
  log?: (line: string) => void
}

export function createSyncHandler(options: HandlerOptions) {
  const { store, token } = options
  const limiter = options.limiter ?? new RateLimiter()
  const log = options.log ?? ((line: string) => console.log(line))

  async function route(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    if (limiter.isBlocked(ip)) {
      sendError(res, 429, 'rate_limited', '令牌错误次数过多，请稍后再试')
      return
    }
    if (!limiter.allowRequest(ip)) {
      sendError(res, 429, 'rate_limited', '请求过于频繁，请稍后再试')
      return
    }

    const path = new URL(req.url ?? '/', 'https://localhost').pathname
    if (path !== '/v1/ping' && path !== '/v1/sync') {
      sendError(res, 404, 'not_found', '接口不存在')
      return
    }

    const provided = bearerToken(req.headers.authorization)
    if (!provided || !tokenMatches(provided, token)) {
      limiter.recordFailure(ip)
      sendError(res, 401, 'unauthorized', '令牌不正确')
      return
    }

    if (path === '/v1/ping') {
      if (req.method !== 'GET') {
        sendError(res, 405, 'method_not_allowed', '请使用 GET')
        return
      }
      const body: PingResponse = {
        protocol: PROTOCOL_VERSION,
        serverId: store.serverId,
        serverTime: new Date().toISOString(),
      }
      sendJson(res, 200, body)
      return
    }

    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed', '请使用 POST')
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(await readBody(req))
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendError(res, 413, 'too_large', '请求内容过大')
      } else {
        sendError(res, 400, 'invalid_json', '请求内容不是合法的 JSON')
      }
      return
    }

    if (typeof parsed !== 'object' || parsed === null) {
      sendError(res, 400, 'invalid_request', '请求格式不正确')
      return
    }
    const { protocol, cursor, changes } = parsed as Record<string, unknown>

    if (protocol !== PROTOCOL_VERSION) {
      sendError(res, 409, 'protocol_mismatch', '客户端和服务器的同步协议版本不一致，请把两边升级到同一版本')
      return
    }
    if (typeof cursor !== 'number' || !Number.isSafeInteger(cursor) || cursor < 0) {
      sendError(res, 400, 'invalid_request', 'cursor 必须是非负整数')
      return
    }
    if (!Array.isArray(changes)) {
      sendError(res, 400, 'invalid_request', 'changes 必须是数组')
      return
    }
    if (changes.length > MAX_PUSH_PER_REQUEST) {
      sendError(res, 413, 'too_many_changes', `一次最多推送 ${MAX_PUSH_PER_REQUEST} 条记录`)
      return
    }

    const records: SyncRecord[] = []
    for (const [index, change] of changes.entries()) {
      const record = parseSyncRecord(change)
      if (!record) {
        sendError(res, 400, 'invalid_record', `第 ${index + 1} 条记录格式不正确`)
        return
      }
      records.push(record)
    }

    const applied = store.apply(records)
    const pulled = store.pull(cursor)
    const body: SyncResponse = {
      protocol: PROTOCOL_VERSION,
      serverId: store.serverId,
      cursor: pulled.cursor,
      changes: pulled.changes,
      more: pulled.more,
      serverTime: new Date().toISOString(),
    }
    sendJson(res, 200, body)
    log(
      `sync ip=${ip} pushed=${records.length} accepted=${applied.accepted} ` +
        `repaired=${applied.repaired} pulled=${pulled.changes.length} cursor=${pulled.cursor}`,
    )
  }

  return (req: IncomingMessage, res: ServerResponse): void => {
    const started = Date.now()
    const ip = req.socket.remoteAddress ?? 'unknown'

    route(req, res, ip)
      .catch((error: unknown) => {
        log(`error ${req.method} ${req.url}: ${error instanceof Error ? error.stack : String(error)}`)
        if (!res.headersSent) sendError(res, 500, 'internal', '服务器内部错误')
      })
      .finally(() => {
        // 不记录 Authorization 头，日志里不会出现令牌
        log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms ${ip}`)
      })
  }
}
