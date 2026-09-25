import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { PomodoroController } from '../hooks/usePomodoro'
import type { Task } from '../types'
import { formatClock } from '../utils'

interface PomodoroTimerProps {
  tasks: Task[]
  completedToday: number
  hasOtherFocus: boolean
  pomodoro: PomodoroController
}

export function PomodoroTimer({
  tasks,
  completedToday,
  hasOtherFocus,
  pomodoro,
}: PomodoroTimerProps) {
  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'done'),
    [tasks],
  )

  const progress =
    pomodoro.totalSeconds > 0 ? 1 - pomodoro.remaining / pomodoro.totalSeconds : 0
  const progressDeg = Math.round(Math.min(1, Math.max(0, progress)) * 360)

  return (
    <section className={`panel pomodoro-panel phase-${pomodoro.phase}`}>
      <div className="pomodoro-layout">
        <div
          className="pomodoro-ring"
          style={{ '--progress': `${progressDeg}deg` } as CSSProperties}
        >
          <div className="pomodoro-ring-inner">
            <span>{pomodoro.phaseLabel}</span>
            <strong>{formatClock(pomodoro.remaining)}</strong>
            <small>{pomodoro.actionLabel === '开始' ? '准备开始' : pomodoro.actionLabel}</small>
          </div>
        </div>

        <div className="pomodoro-body">
          <div className="section-header compact">
            <div>
              <h2>番茄钟</h2>
              <p>
                今日完成 <strong>{completedToday}</strong> 个番茄 · 本轮已完成{' '}
                <strong>{pomodoro.completedSessions}</strong> 个
              </p>
            </div>
          </div>

          <label className="field">
            <span>关联任务</span>
            <select
              value={pomodoro.selectedTaskId}
              onChange={(event) => pomodoro.setSelectedTaskId(event.target.value)}
              disabled={pomodoro.focusLocked}
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
            <button type="button" className="button primary" onClick={pomodoro.toggleTimer}>
              {pomodoro.actionLabel}
            </button>
            <button type="button" className="button ghost" onClick={pomodoro.resetTimer}>
              重置
            </button>
            <button type="button" className="button ghost" onClick={pomodoro.skipPhase}>
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
                  value={pomodoro.settings.focusMinutes}
                  onChange={(event) =>
                    pomodoro.updateSetting('focusMinutes', event.target.value)
                  }
                />
                <span>分钟</span>
              </label>
              <label>
                短休息
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={pomodoro.settings.shortBreakMinutes}
                  onChange={(event) =>
                    pomodoro.updateSetting('shortBreakMinutes', event.target.value)
                  }
                />
                <span>分钟</span>
              </label>
              <label>
                长休息
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={pomodoro.settings.longBreakMinutes}
                  onChange={(event) =>
                    pomodoro.updateSetting('longBreakMinutes', event.target.value)
                  }
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
