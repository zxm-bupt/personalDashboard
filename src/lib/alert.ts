import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { PomodoroPhase } from '../hooks/usePomodoro'
import { isTauri } from './tauri'

/** 系统通知里的“开始休息 / 开始专注”按钮被点击时由 Rust 发出，和 src-tauri/src/alert.rs 保持一致。 */
export const POMODORO_START_NEXT_EVENT = 'pomodoro://start-next'

export interface PomodoroAlertContent {
  title: string
  body: string
  /** 系统通知按钮上的文字。 */
  actionLabel: string
  /** 按钮要开始的阶段，点击时原样带回，用来核对番茄钟是否仍停在这一阶段。 */
  nextPhase: PomodoroPhase
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null
  audioContext ??= new window.AudioContext()
  return audioContext
}

/**
 * 在用户点击“开始”时调用。浏览器的自动播放策略要求 AudioContext 在用户手势里
 * 激活，否则到时提醒的声音会被静音；同时顺带申请网页通知权限。
 */
export function primeAlerts(): void {
  const context = getAudioContext()
  if (context?.state === 'suspended') void context.resume()

  if (!isTauri() && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission()
  }
}

/** 两声上行的提示音，用振荡器合成，不需要额外的音频文件。 */
function playChime(): void {
  const context = getAudioContext()
  if (!context) return
  if (context.state === 'suspended') void context.resume()

  const notes = [
    { frequency: 880, offset: 0 },
    { frequency: 1318.5, offset: 0.22 },
  ]

  for (const { frequency, offset } of notes) {
    const start = context.currentTime + offset
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6)

    oscillator.connect(gain).connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.65)
  }
}

/**
 * 到时提醒的系统侧效果。应用在前台时只播放提示音，提醒交给应用内的 PomodoroAlert；
 * 不在前台时发系统通知：点击正文回到应用（桌面端会把隐藏在托盘里的窗口唤回），
 * 点击“开始休息 / 开始专注”按钮直接开始下一阶段（见 listenPomodoroStartNext）。
 * 应用内弹窗无论哪种情况都会保留，回到应用时可以直接一键开始下一阶段。
 */
export async function raisePomodoroAlert(content: PomodoroAlertContent): Promise<void> {
  const { title, body } = content

  if (isTauri()) {
    // 由 Rust 判断主窗口是否在前台：在前台就只播提示音、让应用内弹窗出场；
    // 不在前台就改发系统通知，通知自带系统提示音，这里不再重复播放
    const foreground = await invoke<boolean>('pomodoro_alert', { content })
    if (foreground) playChime()
    return
  }

  playChime()

  // 网页端同样只在页面不在前台时才发系统通知，点击通知回到这个标签页
  const inForeground = document.visibilityState === 'visible' && document.hasFocus()
  if (inForeground) return

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const notification = new Notification(title, { body })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }
}

/**
 * 监听系统通知按钮。网页端的 Notification 只有经由 Service Worker 发出才能带按钮，
 * 这里没有用 Service Worker，所以按钮只在桌面端出现，网页端直接返回空操作。
 */
export async function listenPomodoroStartNext(
  handler: (phase: PomodoroPhase) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen<{ phase: PomodoroPhase }>(POMODORO_START_NEXT_EVENT, (event) =>
    handler(event.payload.phase),
  )
}
