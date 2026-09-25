import { useEffect, useRef, useState } from 'react'
import { isTauri } from '../lib/tauri'
import { listenTrayTogglePomodoro, updateTray } from '../lib/tray'
import type { TraySnapshot } from '../lib/tray'
import type { Checkin } from '../types'
import { durationSeconds, formatDuration, formatHourClock, formatTime } from '../utils'
import type { PomodoroController } from './usePomodoro'

interface UseTrayOptions {
  activeCheckin: Checkin | null
  pomodoro: PomodoroController
}

/** 打卡时长只需分钟级精度，30 秒刷新一次即可。 */
const CHECKIN_REFRESH_MS = 30_000

function buildSnapshot(
  activeCheckin: Checkin | null,
  pomodoro: PomodoroController,
): TraySnapshot {
  const workedSeconds = activeCheckin
    ? durationSeconds(activeCheckin.clockInAt, null)
    : 0
  const checkinLabel = activeCheckin
    ? `上班 ${formatTime(activeCheckin.clockInAt)} · 已工作 ${formatDuration(workedSeconds)}`
    : '今天还没有打卡'

  const minutesLeft = Math.max(1, Math.ceil(pomodoro.remaining / 60))
  const pomodoroLabel = pomodoro.running
    ? `${pomodoro.phaseLabel}中 · 剩余 ${minutesLeft} 分钟`
    : pomodoro.isPaused
      ? `${pomodoro.phaseLabel}已暂停 · 剩余 ${minutesLeft} 分钟`
      : `${pomodoro.phaseLabel} · 未开始`

  return {
    title: activeCheckin ? formatHourClock(workedSeconds) : '',
    tooltip: `个人工作台 · ${checkinLabel}`,
    checkinLabel,
    pomodoroLabel,
    pomodoroActionLabel: `${pomodoro.actionLabel}番茄钟`,
  }
}

/**
 * 把打卡状态和番茄钟状态同步到系统托盘，并接收托盘发来的番茄钟开关指令。
 * 浏览器环境下整体降级为空操作。
 */
export function useTray({ activeCheckin, pomodoro }: UseTrayOptions): void {
  const [checkinTick, setCheckinTick] = useState(0)
  const lastSnapshotRef = useRef('')
  const toggleRef = useRef(pomodoro.toggleTimer)

  useEffect(() => {
    toggleRef.current = pomodoro.toggleTimer
  })

  useEffect(() => {
    if (!isTauri() || !activeCheckin) return

    const interval = window.setInterval(
      () => setCheckinTick((tick) => tick + 1),
      CHECKIN_REFRESH_MS,
    )
    return () => window.clearInterval(interval)
  }, [activeCheckin])

  useEffect(() => {
    if (!isTauri()) return

    const snapshot = buildSnapshot(activeCheckin, pomodoro)
    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSnapshotRef.current) return
    lastSnapshotRef.current = serialized

    void updateTray(snapshot).catch((error) => {
      console.error('更新系统托盘失败', error)
    })
  }, [activeCheckin, checkinTick, pomodoro])

  useEffect(() => {
    if (!isTauri()) return

    let cancelled = false
    let unlisten: (() => void) | undefined

    void listenTrayTogglePomodoro(() => toggleRef.current())
      .then((dispose) => {
        if (cancelled) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch((error) => {
        console.error('监听托盘事件失败', error)
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
