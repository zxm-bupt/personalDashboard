import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from './tauri'

/** 托盘菜单点击“开始/暂停番茄钟”时由 Rust 侧发出。 */
export const TRAY_TOGGLE_POMODORO_EVENT = 'tray://toggle-pomodoro'

/**
 * 托盘上展示的全部文案，由前端统一格式化后整体下发，Rust 侧只负责写入。
 */
export interface TraySnapshot {
  /** macOS 菜单栏上紧跟图标的文字，空字符串表示不显示。 */
  title: string
  tooltip: string
  checkinLabel: string
  pomodoroLabel: string
  pomodoroActionLabel: string
}

export async function updateTray(snapshot: TraySnapshot): Promise<void> {
  if (!isTauri()) return
  await invoke('update_tray', { snapshot })
}

export async function listenTrayTogglePomodoro(
  handler: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen(TRAY_TOGGLE_POMODORO_EVENT, () => handler())
}
