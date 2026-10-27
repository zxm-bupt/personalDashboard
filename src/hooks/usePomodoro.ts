import { useEffect, useRef, useState } from 'react'

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak'

export interface PomodoroSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
}

export interface PomodoroController {
  phase: PomodoroPhase
  phaseLabel: string
  remaining: number
  totalSeconds: number
  running: boolean
  isPaused: boolean
  /** 主按钮和托盘共用的动作文案：开始 / 继续 / 暂停。 */
  actionLabel: string
  completedSessions: number
  settings: PomodoroSettings
  selectedTaskId: string
  focusLocked: boolean
  setSelectedTaskId: (taskId: string) => void
  toggleTimer: () => void
  resetTimer: () => void
  skipPhase: () => void
  updateSetting: (key: keyof PomodoroSettings, rawValue: string) => void
}

interface UsePomodoroOptions {
  hasOtherFocus: boolean
  onCompleteFocus: (input: {
    taskId: string | null
    startedAt: string
    endedAt: string
  }) => void
  onStopOtherFocus: () => void
  /** 某个阶段自然走完时调用（手动跳过、重置不会触发），用来弹出到时提醒。 */
  onPhaseComplete?: (event: PomodoroPhaseCompleteEvent) => void
}

export interface PomodoroPhaseCompleteEvent {
  finished: PomodoroPhase
  next: PomodoroPhase
  nextMinutes: number
}

const SETTINGS_KEY = 'personal-workbench:pomodoro-settings'

const defaultSettings: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
}

function loadSettings(): PomodoroSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings
    const parsed = JSON.parse(raw) as Partial<PomodoroSettings>
    return {
      focusMinutes: parsed.focusMinutes ?? defaultSettings.focusMinutes,
      shortBreakMinutes: parsed.shortBreakMinutes ?? defaultSettings.shortBreakMinutes,
      longBreakMinutes: parsed.longBreakMinutes ?? defaultSettings.longBreakMinutes,
    }
  } catch {
    return defaultSettings
  }
}

export function phaseDuration(phase: PomodoroPhase, settings: PomodoroSettings): number {
  if (phase === 'focus') return settings.focusMinutes * 60
  if (phase === 'shortBreak') return settings.shortBreakMinutes * 60
  return settings.longBreakMinutes * 60
}

export function phaseLabel(phase: PomodoroPhase): string {
  if (phase === 'focus') return '专注'
  if (phase === 'shortBreak') return '短休息'
  return '长休息'
}

/** 到时提醒的文案，应用内弹窗和系统通知共用，保证两边说法一致。 */
export function describePhaseComplete(event: PomodoroPhaseCompleteEvent): {
  title: string
  body: string
  actionLabel: string
} {
  if (event.finished === 'focus') {
    return {
      title: '专注完成',
      body: `辛苦了，接下来${phaseLabel(event.next)} ${event.nextMinutes} 分钟。`,
      actionLabel: '开始休息',
    }
  }

  return {
    title: '休息结束',
    body: `准备开始下一个番茄，专注 ${event.nextMinutes} 分钟。`,
    actionLabel: '开始专注',
  }
}

/**
 * 番茄钟状态机。提升到 App 层，让系统托盘和时间页共享同一个计时器。
 */
export function usePomodoro({
  hasOtherFocus,
  onCompleteFocus,
  onStopOtherFocus,
  onPhaseComplete,
}: UsePomodoroOptions): PomodoroController {
  const [settings, setSettings] = useState<PomodoroSettings>(loadSettings)
  const [phase, setPhase] = useState<PomodoroPhase>('focus')
  const [remaining, setRemaining] = useState(() => phaseDuration('focus', settings))
  const [running, setRunning] = useState(false)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [focusStartedAt, setFocusStartedAt] = useState<number | null>(null)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [completedSessions, setCompletedSessions] = useState(0)

  const completingRef = useRef(false)
  const completePhaseRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch (error) {
      console.warn('无法保存番茄钟设置', error)
    }
  }, [settings])

  const completePhase = () => {
    const timestamp = Date.now()

    if (phase === 'focus') {
      const duration = phaseDuration('focus', settings)
      const startedAt = focusStartedAt ?? timestamp - duration * 1000
      onCompleteFocus({
        taskId: focusTaskId,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(timestamp).toISOString(),
      })

      const nextCount = completedSessions + 1
      setCompletedSessions(nextCount)
      const nextPhase: PomodoroPhase = nextCount % 4 === 0 ? 'longBreak' : 'shortBreak'
      setPhase(nextPhase)
      setRemaining(phaseDuration(nextPhase, settings))
      onPhaseComplete?.({
        finished: phase,
        next: nextPhase,
        nextMinutes: phaseDuration(nextPhase, settings) / 60,
      })
    } else {
      setPhase('focus')
      setRemaining(phaseDuration('focus', settings))
      onPhaseComplete?.({
        finished: phase,
        next: 'focus',
        nextMinutes: phaseDuration('focus', settings) / 60,
      })
    }

    setRunning(false)
    setEndAt(null)
    setFocusStartedAt(null)
    setFocusTaskId(null)
  }

  useEffect(() => {
    completePhaseRef.current = completePhase
  })

  useEffect(() => {
    if (!running || endAt === null) return

    const tick = () => {
      const next = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
      setRemaining(next)

      if (next <= 0 && !completingRef.current) {
        completingRef.current = true
        completePhaseRef.current()
        window.setTimeout(() => {
          completingRef.current = false
        }, 0)
      }
    }

    tick()
    const interval = window.setInterval(tick, 250)
    return () => window.clearInterval(interval)
  }, [running, endAt])

  const toggleTimer = () => {
    if (running) {
      const next = endAt ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) : remaining
      setRemaining(next)
      setEndAt(null)
      setRunning(false)
      return
    }

    const duration = phaseDuration(phase, settings)
    const nextRemaining = remaining <= 0 ? duration : remaining

    if (phase === 'focus') {
      if (hasOtherFocus) onStopOtherFocus()
      if (focusStartedAt === null) {
        setFocusStartedAt(Date.now())
        setFocusTaskId(selectedTaskId || null)
      }
    }

    completingRef.current = false
    setRemaining(nextRemaining)
    setEndAt(Date.now() + nextRemaining * 1000)
    setRunning(true)
  }

  const resetTimer = () => {
    completingRef.current = false
    setRunning(false)
    setEndAt(null)
    setFocusStartedAt(null)
    setFocusTaskId(null)
    setRemaining(phaseDuration(phase, settings))
  }

  const skipPhase = () => {
    completingRef.current = false
    setRunning(false)
    setEndAt(null)
    setFocusStartedAt(null)
    setFocusTaskId(null)

    if (phase === 'focus') {
      const nextPhase: PomodoroPhase =
        completedSessions % 4 === 3 ? 'longBreak' : 'shortBreak'
      setPhase(nextPhase)
      setRemaining(phaseDuration(nextPhase, settings))
    } else {
      setPhase('focus')
      setRemaining(phaseDuration('focus', settings))
    }
  }

  const updateSetting = (key: keyof PomodoroSettings, rawValue: string) => {
    const value = Math.min(180, Math.max(1, Number(rawValue) || 1))
    const nextSettings = { ...settings, [key]: value }
    setSettings(nextSettings)

    if (!running) {
      setRemaining(phaseDuration(phase, nextSettings))
      setEndAt(null)
      setFocusStartedAt(null)
      setFocusTaskId(null)
    }
  }

  const totalSeconds = phaseDuration(phase, settings)
  const isPaused = !running && remaining < totalSeconds && remaining > 0

  return {
    phase,
    phaseLabel: phaseLabel(phase),
    remaining,
    totalSeconds,
    running,
    isPaused,
    actionLabel: running ? '暂停' : isPaused ? '继续' : '开始',
    completedSessions,
    settings,
    selectedTaskId,
    focusLocked: phase === 'focus' && focusStartedAt !== null,
    setSelectedTaskId,
    toggleTimer,
    resetTimer,
    skipPhase,
    updateSetting,
  }
}
