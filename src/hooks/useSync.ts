import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearSyncConfig,
  exchangeSync,
  getSyncConfig,
  pingSyncServer,
  saveSyncConfig,
  syncAvailable,
} from '../lib/sync'
import type { SyncConfig, SyncConfigInput } from '../lib/sync'
import { runSync } from '../sync/engine.ts'
import type { WorkbenchState } from '../types'

export type SyncPhase = 'idle' | 'syncing' | 'error' | 'paused'

export interface SyncController {
  available: boolean
  config: SyncConfig | null
  phase: SyncPhase
  message: string | null
  lastSyncAt: string | null
  syncNow: () => Promise<void>
  saveConfig: (input: SyncConfigInput) => Promise<SyncConfig>
  clearConfig: () => Promise<void>
  /** 测试连接，返回本机时间与服务器时间的偏差（毫秒，正数表示本机慢）。 */
  testConnection: () => Promise<{ skewMs: number }>
}

interface UseSyncOptions {
  store: WorkbenchState
  ready: boolean
  updateStore: (updater: (previous: WorkbenchState) => WorkbenchState) => void
}

const SYNC_INTERVAL_MS = 60_000
/** 本地改动后等一会儿再推送，连续操作只同步一次。 */
const CHANGE_DEBOUNCE_MS = 5_000

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function confirmRemovals(count: number): boolean {
  return window.confirm(
    `这次同步会删除这台 Mac 上的 ${count} 条记录（它们在其他设备上已被删除）。确定继续吗？\n\n` +
      '选择“取消”会暂停自动同步，直到你在同步设置里手动同步。',
  )
}

export function useSync({ store, ready, updateStore }: UseSyncOptions): SyncController {
  const available = syncAvailable()
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const storeRef = useRef(store)
  useEffect(() => {
    storeRef.current = store
  })
  const inFlightRef = useRef(false)
  // 用户拒绝了一次批量删除：自动同步暂停，直到手动同步
  const pausedRef = useRef(false)

  useEffect(() => {
    if (!available) return
    getSyncConfig()
      .then(setConfig)
      .catch((error) => {
        setPhase('error')
        setMessage(describeError(error))
      })
  }, [available])

  const configured = Boolean(config?.configured)

  const run = useCallback(
    async (manual: boolean) => {
      if (!available || !configured || inFlightRef.current) return
      if (pausedRef.current && !manual) return

      inFlightRef.current = true
      setPhase('syncing')
      setMessage(null)
      try {
        const outcome = await runSync({
          exchange: exchangeSync,
          getStore: () => storeRef.current,
          update: updateStore,
          confirmRemovals,
        })
        if (outcome.status === 'paused') {
          pausedRef.current = true
          setPhase('paused')
          setMessage(`有 ${outcome.pendingRemovals} 条删除等待确认，自动同步已暂停`)
        } else {
          pausedRef.current = false
          setPhase('idle')
        }
      } catch (error) {
        setPhase('error')
        setMessage(describeError(error))
      } finally {
        inFlightRef.current = false
      }
    },
    [available, configured, updateStore],
  )

  // 启动和配置完成后同步一次；之后每分钟一次，窗口回到前台时也同步
  useEffect(() => {
    if (!ready || !configured) return
    // 放到下一轮事件循环：run 会立刻更新同步状态，不能在 effect 里同步触发
    const initial = window.setTimeout(() => void run(false), 0)
    const interval = window.setInterval(() => void run(false), SYNC_INTERVAL_MS)
    const onFocus = () => void run(false)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [ready, configured, run])

  // 本地数据变化后稍等几秒推送。合并远端结果如果没有任何变化会保持原对象，不会触发这里
  useEffect(() => {
    if (!ready || !configured) return
    const timeout = window.setTimeout(() => void run(false), CHANGE_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [ready, configured, run, store.tasks, store.timeEntries, store.checkins])

  /** 换了服务器或停用同步：游标、水位线都作废，下次同步全量进行。 */
  const resetSyncMeta = useCallback(() => {
    updateStore((previous) => ({
      ...previous,
      sync: { ...previous.sync, cursor: null, pushedUntil: null, serverId: null, lastSyncAt: null },
    }))
  }, [updateStore])

  const saveConfig = useCallback(
    async (input: SyncConfigInput) => {
      const previousUrl = config?.serverUrl ?? null
      const next = await saveSyncConfig(input)
      if (next.serverUrl !== previousUrl) resetSyncMeta()
      pausedRef.current = false
      setConfig(next)
      setPhase('idle')
      setMessage(null)
      return next
    },
    [config?.serverUrl, resetSyncMeta],
  )

  const clearConfig = useCallback(async () => {
    await clearSyncConfig()
    resetSyncMeta()
    pausedRef.current = false
    setConfig(await getSyncConfig())
    setPhase('idle')
    setMessage(null)
  }, [resetSyncMeta])

  const testConnection = useCallback(async () => {
    const ping = await pingSyncServer()
    return { skewMs: Date.parse(ping.serverTime) - Date.now() }
  }, [])

  const syncNow = useCallback(() => run(true), [run])

  return {
    available,
    config,
    phase,
    message,
    lastSyncAt: store.sync.lastSyncAt,
    syncNow,
    saveConfig,
    clearConfig,
    testConnection,
  }
}
