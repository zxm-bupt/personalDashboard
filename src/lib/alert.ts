import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './tauri'

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
 * 到时提醒的系统侧效果：桌面端把隐藏到托盘的窗口唤回前台并请求关注（Dock 跳动），
 * 网页端在已授权时发一条浏览器通知。应用内的弹窗由 PomodoroAlert 负责。
 */
export async function raisePomodoroAlert(title: string, body: string): Promise<void> {
  playChime()

  if (isTauri()) {
    await invoke('pomodoro_alert')
    return
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body })
  }
}
