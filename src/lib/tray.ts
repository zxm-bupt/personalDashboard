import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from './tauri'

/** 托盘菜单点击动作项时由 Rust 侧发出。 */
export const TRAY_TOGGLE_POMODORO_EVENT = 'tray://toggle-pomodoro'
export const TRAY_TOGGLE_CHECKIN_EVENT = 'tray://toggle-checkin'

/**
 * 托盘上展示的全部文案，由前端统一格式化后整体下发，Rust 侧只负责写入。
 */
export interface TraySnapshot {
  tooltip: string
  checkinLabel: string
  checkinActionLabel: string
  pomodoroLabel: string
  pomodoroActionLabel: string
}

export async function updateTray(snapshot: TraySnapshot): Promise<void> {
  if (!isTauri()) return
  await invoke('update_tray', { snapshot })
}

export async function listenTrayEvent(
  event: string,
  handler: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen(event, () => handler())
}
