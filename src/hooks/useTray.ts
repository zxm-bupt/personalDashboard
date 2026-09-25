import { useEffect, useRef, useState } from 'react'
import { isTauri } from '../lib/tauri'
import {
  TRAY_TOGGLE_CHECKIN_EVENT,
  TRAY_TOGGLE_POMODORO_EVENT,
  listenTrayEvent,
  updateTray,
} from '../lib/tray'
import type { TraySnapshot } from '../lib/tray'
import type { Checkin } from '../types'
import { formatDuration, formatTime, summarizeCheckins } from '../utils'
import type { PomodoroController } from './usePomodoro'

interface UseTrayOptions {
  checkins: Checkin[]
  pomodoro: PomodoroController
  onClockIn: () => void
  onClockOut: () => void
}

/** 打卡时长只需分钟级精度，30 秒刷新一次即可。 */
const CHECKIN_REFRESH_MS = 30_000

function buildSnapshot(checkins: Checkin[], pomodoro: PomodoroController): TraySnapshot {
  const checkin = summarizeCheckins(checkins)

  let checkinLabel: string
  if (checkin.status === 'working') {
    checkinLabel = `上班 ${formatTime(checkin.firstClockInAt)} · 已工作 ${formatDuration(checkin.workedSeconds)}`
  } else if (checkin.status === 'finished') {
    checkinLabel = `${formatTime(checkin.firstClockInAt)} - ${formatTime(checkin.lastClockOutAt)} · 共 ${formatDuration(checkin.workedSeconds)}`
  } else {
    checkinLabel = '今天还没有打卡'
  }

  const minutesLeft = Math.max(1, Math.ceil(pomodoro.remaining / 60))
  const pomodoroLabel = pomodoro.running
    ? `${pomodoro.phaseLabel}中 · 剩余 ${minutesLeft} 分钟`
    : pomodoro.isPaused
      ? `${pomodoro.phaseLabel}已暂停 · 剩余 ${minutesLeft} 分钟`
      : `${pomodoro.phaseLabel} · 未开始`

  return {
    tooltip: `个人工作台 · ${checkinLabel}`,
    checkinLabel,
    checkinActionLabel: checkin.status === 'working' ? '下班打卡' : '上班打卡',
    pomodoroLabel,
    pomodoroActionLabel: `${pomodoro.actionLabel}番茄钟`,
  }
}

/**
 * 把打卡状态和番茄钟状态同步到系统托盘，并接收托盘发来的打卡 / 番茄钟指令。
 * 浏览器环境下整体降级为空操作。
 */
export function useTray({
  checkins,
  pomodoro,
  onClockIn,
  onClockOut,
}: UseTrayOptions): void {
  const [checkinTick, setCheckinTick] = useState(0)
  const lastSnapshotRef = useRef('')
  const isWorking = summarizeCheckins(checkins).status === 'working'

  // 托盘监听只注册一次，动作通过 ref 读取最新的处理函数
  const actionsRef = useRef({
    togglePomodoro: pomodoro.toggleTimer,
    toggleCheckin: () => (isWorking ? onClockOut() : onClockIn()),
  })

  useEffect(() => {
    actionsRef.current = {
      togglePomodoro: pomodoro.toggleTimer,
      toggleCheckin: () => (isWorking ? onClockOut() : onClockIn()),
    }
  })

  useEffect(() => {
    if (!isTauri() || !isWorking) return

    const interval = window.setInterval(
      () => setCheckinTick((tick) => tick + 1),
      CHECKIN_REFRESH_MS,
    )
    return () => window.clearInterval(interval)
  }, [isWorking])

  useEffect(() => {
    if (!isTauri()) return

    const snapshot = buildSnapshot(checkins, pomodoro)
    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSnapshotRef.current) return
    lastSnapshotRef.current = serialized

    void updateTray(snapshot).catch((error) => {
      console.error('更新系统托盘失败', error)
    })
  }, [checkins, checkinTick, pomodoro])

  useEffect(() => {
    if (!isTauri()) return

    let cancelled = false
    const disposers: Array<() => void> = []

    const subscribe = (event: string, handler: () => void) => {
      void listenTrayEvent(event, handler)
        .then((dispose) => {
          if (cancelled) {
            dispose()
            return
          }
          disposers.push(dispose)
        })
        .catch((error) => {
          console.error(`监听托盘事件 ${event} 失败`, error)
        })
    }

    subscribe(TRAY_TOGGLE_POMODORO_EVENT, () => actionsRef.current.togglePomodoro())
    subscribe(TRAY_TOGGLE_CHECKIN_EVENT, () => actionsRef.current.toggleCheckin())

    return () => {
      cancelled = true
      disposers.forEach((dispose) => dispose())
    }
  }, [])
}
