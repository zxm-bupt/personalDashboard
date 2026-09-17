import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Task } from '../types'
import { formatClock } from '../utils'

type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak'

interface PomodoroSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
}

interface PomodoroTimerProps {
  tasks: Task[]
  completedToday: number
  hasOtherFocus: boolean
  onCompleteFocus: (input: {
    taskId: string | null
    startedAt: string
    endedAt: string
  }) => void
  onStopOtherFocus: () => void
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

function phaseDuration(phase: PomodoroPhase, settings: PomodoroSettings): number {
  if (phase === 'focus') return settings.focusMinutes * 60
  if (phase === 'shortBreak') return settings.shortBreakMinutes * 60
  return settings.longBreakMinutes * 60
}

function phaseLabel(phase: PomodoroPhase): string {
  if (phase === 'focus') return '专注'
  if (phase === 'shortBreak') return '短休息'
  return '长休息'
}

export function PomodoroTimer({
  tasks,
  completedToday,
  hasOtherFocus,
  onCompleteFocus,
  onStopOtherFocus,
}: PomodoroTimerProps) {
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

  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'done'),
    [tasks],
  )

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
    } else {
      setPhase('focus')
      setRemaining(phaseDuration('focus', settings))
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
  const progress = totalSeconds > 0 ? 1 - remaining / totalSeconds : 0
  const progressDeg = Math.round(Math.min(1, Math.max(0, progress)) * 360)
  const isPaused = !running && remaining < totalSeconds && remaining > 0
  const buttonLabel = running ? '暂停' : isPaused ? '继续' : '开始'
  const focusLocked = phase === 'focus' && focusStartedAt !== null

  return (
    <section className={`panel pomodoro-panel phase-${phase}`}>
      <div className="pomodoro-layout">
        <div
          className="pomodoro-ring"
          style={{ '--progress': `${progressDeg}deg` } as CSSProperties}
        >
          <div className="pomodoro-ring-inner">
            <span>{phaseLabel(phase)}</span>
            <strong>{formatClock(remaining)}</strong>
            <small>{buttonLabel === '开始' ? '准备开始' : buttonLabel}</small>
          </div>
        </div>

        <div className="pomodoro-body">
          <div className="section-header compact">
            <div>
              <h2>番茄钟</h2>
              <p>
                今日完成 <strong>{completedToday}</strong> 个番茄 · 本轮已完成{' '}
                <strong>{completedSessions}</strong> 个
              </p>
            </div>
          </div>

          <label className="field">
            <span>关联任务</span>
            <select
              value={selectedTaskId}
              onChange={(event) => setSelectedTaskId(event.target.value)}
              disabled={focusLocked}
            >
              <option value="">不关联任务</option>
              {pendingTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>

          {hasOtherFocus && (
            <p className="pomodoro-hint">开始番茄钟会先停止当前的任务计时。</p>
          )}

          <div className="pomodoro-actions">
            <button type="button" className="button primary" onClick={toggleTimer}>
              {buttonLabel}
            </button>
            <button type="button" className="button ghost" onClick={resetTimer}>
              重置
            </button>
            <button type="button" className="button ghost" onClick={skipPhase}>
              跳过
            </button>
          </div>

          <details className="pomodoro-settings">
            <summary>时长设置</summary>
            <div className="pomodoro-settings-grid">
              <label>
                专注
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={settings.focusMinutes}
                  onChange={(event) => updateSetting('focusMinutes', event.target.value)}
                />
                <span>分钟</span>
              </label>
              <label>
                短休息
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.shortBreakMinutes}
                  onChange={(event) => updateSetting('shortBreakMinutes', event.target.value)}
                />
                <span>分钟</span>
              </label>
              <label>
                长休息
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={settings.longBreakMinutes}
                  onChange={(event) => updateSetting('longBreakMinutes', event.target.value)}
                />
                <span>分钟</span>
              </label>
            </div>
          </details>
        </div>
      </div>
    </section>
  )
}
