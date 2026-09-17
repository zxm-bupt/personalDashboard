import { useEffect, useMemo, useState } from 'react'
import { PomodoroTimer } from '../components/PomodoroTimer'
import type { Checkin, Task, TimeEntry } from '../types'
import {
  durationSeconds,
  formatDuration,
  formatTime,
  sortTimeEntries,
  toDateKey,
} from '../utils'

interface TimePageProps {
  tasks: Task[]
  timeEntries: TimeEntry[]
  checkins: Checkin[]
  activeCheckin: Checkin | null
  activeTimer: TimeEntry | null
  onClockIn: () => void
  onClockOut: () => void
  onStopTimer: () => void
  onCompleteFocus: (input: {
    taskId: string | null
    startedAt: string
    endedAt: string
  }) => void
}

export function TimePage({
  tasks,
  timeEntries,
  checkins,
  activeCheckin,
  activeTimer,
  onClockIn,
  onClockOut,
  onStopTimer,
  onCompleteFocus,
}: TimePageProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const taskMap = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  )
  const sortedEntries = sortTimeEntries(timeEntries).slice(0, 30)
  const activeTask = activeTimer?.taskId ? taskMap.get(activeTimer.taskId) : null
  const activeTimerSeconds = activeTimer
    ? Math.max(0, Math.round((now - new Date(activeTimer.startedAt).getTime()) / 1000))
    : 0
  const today = toDateKey(new Date())
  const todayCheckins = checkins.filter((checkin) => checkin.date === today)
  const focusToday = timeEntries
    .filter((entry) => entry.type === 'focus' && toDateKey(entry.startedAt) === today)
    .reduce((total, entry) => total + durationSeconds(entry.startedAt, entry.endedAt), 0)
  const pomodoroToday = timeEntries.filter(
    (entry) =>
      entry.type === 'focus' &&
      entry.note === '番茄钟' &&
      toDateKey(entry.startedAt) === today,
  ).length

  return (
    <div className="single-column">
      <section className="stats-grid">
        <div className="stat-card">
          <span>今日打卡</span>
          <strong>{todayCheckins.length} 次</strong>
          <small>{activeCheckin ? `上班 ${formatTime(activeCheckin.clockInAt)}` : '当前未打卡'}</small>
        </div>
        <div className="stat-card accent">
          <span>今日专注</span>
          <strong>{formatDuration(focusToday)}</strong>
          <small>累计任务计时</small>
        </div>
        <div className="stat-card success">
          <span>今日番茄</span>
          <strong>{pomodoroToday} 个</strong>
          <small>完整完成的番茄钟</small>
        </div>
        <div className="stat-card success">
          <span>今日记录</span>
          <strong>{sortedEntries.filter((entry) => toDateKey(entry.startedAt) === today).length} 条</strong>
          <small>打卡和计时记录</small>
        </div>
      </section>

      <PomodoroTimer
        tasks={tasks}
        completedToday={pomodoroToday}
        hasOtherFocus={Boolean(activeTimer)}
        onCompleteFocus={onCompleteFocus}
        onStopOtherFocus={onStopTimer}
      />

      <section className="panel checkin-panel">
        <div>
          <p className="eyebrow">上下班打卡</p>
          <h2>{activeCheckin ? '今天正在工作中' : '今天还没有打卡'}</h2>
          <p className="muted">
            {activeCheckin
              ? `上班时间 ${formatTime(activeCheckin.clockInAt)}`
              : '点击打卡后开始记录今天的工作时间。'}
          </p>
        </div>
        {activeCheckin ? (
          <button type="button" className="button primary" onClick={onClockOut}>
            下班打卡
          </button>
        ) : (
          <button type="button" className="button primary" onClick={onClockIn}>
            上班打卡
          </button>
        )}
      </section>

      {activeTimer && (
        <section className="panel active-timer-panel">
          <div>
            <span className="pulse-dot" />
            <div>
              <p className="eyebrow">正在计时</p>
              <h2>{activeTask?.title ?? '未关联任务'}</h2>
              <p className="muted">开始于 {formatTime(activeTimer.startedAt)}</p>
            </div>
          </div>
          <div className="active-timer-right">
            <strong>{formatDuration(activeTimerSeconds)}</strong>
            <button type="button" className="button ghost" onClick={onStopTimer}>
              停止
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="section-header compact">
          <div>
            <h2>时间明细</h2>
            <p>最近 30 条记录</p>
          </div>
        </div>

        {sortedEntries.length > 0 ? (
          <div className="time-list">
            {sortedEntries.map((entry) => {
              const task = entry.taskId ? taskMap.get(entry.taskId) : null
              const seconds = durationSeconds(entry.startedAt, entry.endedAt)
              return (
                <article className="time-row" key={entry.id}>
                  <div className={`time-type ${entry.type}`}>
                    {entry.type === 'focus' ? '专注' : '打卡'}
                  </div>
                  <div className="time-row-main">
                    <strong>{task?.title ?? '未关联任务'}</strong>
                    <small>
                      {toDateKey(entry.startedAt)} {formatTime(entry.startedAt)} -{' '}
                      {entry.endedAt ? formatTime(entry.endedAt) : '进行中'}
                    </small>
                  </div>
                  <div className="time-duration">
                    {formatDuration(seconds)}
                    {!entry.endedAt && <span> · 计时中</span>}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="muted">还没有时间记录。</p>
        )}
      </section>

      <section className="panel">
        <div className="section-header compact">
          <div>
            <h2>打卡历史</h2>
            <p>最近 {checkins.length} 条</p>
          </div>
        </div>

        {checkins.length > 0 ? (
          <ul className="simple-list">
            {checkins.slice(0, 14).map((checkin) => (
              <li key={checkin.id}>
                <span>
                  {checkin.date} · {formatTime(checkin.clockInAt)}
                </span>
                <small>{checkin.clockOutAt ? `下班 ${formatTime(checkin.clockOutAt)}` : '进行中'}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">还没有打卡记录。</p>
        )}
      </section>
    </div>
  )
}
