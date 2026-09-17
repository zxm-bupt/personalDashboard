import { openExternal } from '../lib/tauri'
import type { Checkin, Task, TimeEntry } from '../types'
import {
  durationSeconds,
  formatDuration,
  formatTime,
  isDueSoon,
  isOverdue,
  isToday,
  sortTasks,
  toDateKey,
} from '../utils'
import { TaskCard } from '../components/TaskCard'

interface DashboardPageProps {
  tasks: Task[]
  timeEntries: TimeEntry[]
  activeCheckin: Checkin | null
  activeTimer: TimeEntry | null
  onStartTimer: (taskId: string) => void
  onStopTimer: () => void
  onToggleDone: (taskId: string) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (task: Task) => void
  onOpenResource: (resourceId: string) => void
  onNewTask: () => void
}

export function DashboardPage({
  tasks,
  timeEntries,
  activeCheckin,
  activeTimer,
  onStartTimer,
  onStopTimer,
  onToggleDone,
  onEditTask,
  onDeleteTask,
  onOpenResource,
  onNewTask,
}: DashboardPageProps) {
  const pendingTasks = sortTasks(tasks.filter((task) => task.status !== 'done'))
  const todayTasks = pendingTasks.filter(
    (task) => isToday(task.dueAt) || task.status === 'doing',
  )
  const overdueTasks = pendingTasks.filter(isOverdue)
  const dueSoonTasks = pendingTasks.filter((task) => isDueSoon(task.dueAt)).slice(0, 5)
  const focusToday = timeEntries
    .filter((entry) => entry.type === 'focus' && toDateKey(entry.startedAt) === toDateKey(new Date()))
    .reduce((total, entry) => total + durationSeconds(entry.startedAt, entry.endedAt), 0)
  const activeTask = activeTimer
    ? tasks.find((task) => task.id === activeTimer.taskId) ?? null
    : null
  const resources = tasks.flatMap((task) =>
    task.resources.map((resource) => ({ task, resource })),
  )

  const dashboardTasks = todayTasks.length > 0 ? todayTasks : dueSoonTasks.slice(0, 4)

  return (
    <div className="page-grid">
      <section className="page-main">
        <div className="stats-grid">
          <div className="stat-card">
            <span>今日任务</span>
            <strong>{todayTasks.length}</strong>
            <small>含进行中的任务</small>
          </div>
          <div className="stat-card danger">
            <span>逾期任务</span>
            <strong>{overdueTasks.length}</strong>
            <small>需要优先处理</small>
          </div>
          <div className="stat-card accent">
            <span>今日专注</span>
            <strong>{formatDuration(focusToday)}</strong>
            <small>来自任务计时</small>
          </div>
          <div className="stat-card success">
            <span>打卡状态</span>
            <strong>{activeCheckin ? '工作中' : '未打卡'}</strong>
            <small>
              {activeCheckin
                ? `上班 ${formatTime(activeCheckin.clockInAt)}`
                : '去时间记录页打卡'}
            </small>
          </div>
        </div>

        {activeTimer && activeTask && (
          <div className="running-banner">
            <div>
              <span className="pulse-dot" />
              <div>
                <strong>正在专注：{activeTask.title}</strong>
                <small>开始于 {formatTime(activeTimer.startedAt)}</small>
              </div>
            </div>
            <button type="button" className="button primary small" onClick={onStopTimer}>
              停止计时
            </button>
          </div>
        )}

        <div className="section-header">
          <div>
            <h2>今日关注</h2>
            <p>按 DDL 和状态自动挑选</p>
          </div>
          <button type="button" className="button secondary" onClick={onNewTask}>
            + 新建任务
          </button>
        </div>

        <div className="task-list">
          {dashboardTasks.length > 0 ? (
            dashboardTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                activeTimerTaskId={activeTimer?.taskId ?? null}
                onStartTimer={onStartTimer}
                onStopTimer={onStopTimer}
                onToggleDone={onToggleDone}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
                onOpenResource={onOpenResource}
              />
            ))
          ) : (
            <div className="empty-state">
              <strong>今天还没有任务</strong>
              <p>创建一个任务，设置 DDL、优先级和网页链接。</p>
              <button type="button" className="button primary" onClick={onNewTask}>
                添加第一个任务
              </button>
            </div>
          )}
        </div>
      </section>

      <aside className="page-side">
        <section className="panel">
          <div className="section-header compact">
            <div>
              <h2>网页资源</h2>
              <p>点击直接在新标签页打开</p>
            </div>
          </div>

          {resources.length > 0 ? (
            <div className="quick-links">
              {resources.map(({ task, resource }) => (
                <a
                  key={resource.id}
                  className="quick-link"
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault()
                    onOpenResource(resource.id)
                    void openExternal(resource.url)
                  }}
                >
                  <span className="quick-link-icon">↗</span>
                  <span>
                    <strong>{resource.title}</strong>
                    <small>{task.title}</small>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="muted">还没有网页资源，创建任务时添加即可。</p>
          )}
        </section>

        <section className="panel">
          <div className="section-header compact">
            <div>
              <h2>即将到期</h2>
              <p>未来 7 天内</p>
            </div>
          </div>

          {dueSoonTasks.length > 0 ? (
            <ul className="simple-list">
              {dueSoonTasks.map((task) => (
                <li key={task.id}>
                  <span>{task.title}</span>
                  <small>{task.dueAt ? formatTime(task.dueAt) : ''}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">未来 7 天没有 DDL。</p>
          )}
        </section>
      </aside>
    </div>
  )
}
