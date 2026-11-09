import { invoke } from '@tauri-apps/api/core'
import type { PingResponse, SyncRequest } from '../../server/src/protocol.ts'
import { isTauri } from './tauri'

/** 和 src-tauri/src/sync.rs 的 SyncConfigView 一致。令牌保存后不再返回给前端。 */
export interface SyncConfig {
  configured: boolean
  serverUrl: string | null
  hasToken: boolean
  hasCa: boolean
  caFingerprint: string | null
}

export interface SyncConfigInput {
  serverUrl: string
  /** 留空表示沿用已保存的令牌。 */
  token: string | null
  /** 留空表示沿用已保存的 CA 证书。 */
  caPem: string | null
}

/** 同步只在桌面端提供：请求由 Rust 发出，证书校验只信任用户粘贴的 CA。 */
export function syncAvailable(): boolean {
  return isTauri()
}

export function getSyncConfig(): Promise<SyncConfig> {
  return invoke<SyncConfig>('sync_get_config')
}

export function saveSyncConfig(input: SyncConfigInput): Promise<SyncConfig> {
  return invoke<SyncConfig>('sync_save_config', {
    serverUrl: input.serverUrl,
    token: input.token,
    caPem: input.caPem,
  })
}

export function clearSyncConfig(): Promise<void> {
  return invoke('sync_clear_config')
}

export function pingSyncServer(): Promise<PingResponse> {
  return invoke<PingResponse>('sync_ping')
}

export function exchangeSync(request: SyncRequest): Promise<unknown> {
  return invoke('sync_exchange', { request })
}
