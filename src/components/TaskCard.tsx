import { openExternal } from '../lib/tauri'
import type { Task } from '../types'
import { formatDueLabel, isOverdue, priorityMeta } from '../utils'

interface TaskCardProps {
  task: Task
  compact?: boolean
  activeTimerTaskId: string | null
  onStartTimer: (taskId: string) => void
  onStopTimer: () => void
  onToggleDone: (taskId: string) => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onOpenResource?: (resourceId: string) => void
}

export function TaskCard({
  task,
  compact = false,
  activeTimerTaskId,
  onStartTimer,
  onStopTimer,
  onToggleDone,
  onEdit,
  onDelete,
  onOpenResource,
}: TaskCardProps) {
  const isActive = activeTimerTaskId === task.id
  const overdue = isOverdue(task)

  return (
    <article
      className={[
        'task-card',
        `priority-${task.priority}`,
        task.status === 'done' ? 'is-done' : '',
        compact ? 'compact' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className={task.status === 'done' ? 'task-check checked' : 'task-check'}
        aria-label={task.status === 'done' ? '标记为未完成' : '标记为完成'}
        onClick={() => onToggleDone(task.id)}
      >
        {task.status === 'done' ? '✓' : ''}
      </button>

      <div className="task-body">
        <div className="task-title-row">
          <h3>{task.title}</h3>
          <span className={`priority-pill priority-${task.priority}`}>
            {priorityMeta[task.priority].label}
          </span>
        </div>

        {task.description && <p className="task-description">{task.description}</p>}

        <div className="task-meta">
          <span className={overdue ? 'due-label overdue' : 'due-label'}>
            {formatDueLabel(task.dueAt, task.status === 'done')}
          </span>
          <span className="status-label">{task.status === 'done' ? '已完成' : task.status === 'doing' ? '进行中' : '待办'}</span>
        </div>

        {task.resources.length > 0 && (
          <div className="task-resources">
            {task.resources.map((resource) => (
              <a
                key={resource.id}
                className="resource-chip"
                href={resource.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault()
                  onOpenResource?.(resource.id)
                  void openExternal(resource.url)
                }}
              >
                ↗ {resource.title}
              </a>
            ))}
          </div>
        )}

        {!compact && (
          <div className="task-actions">
            {isActive ? (
              <button type="button" className="button primary small" onClick={onStopTimer}>
                停止计时
              </button>
            ) : (
              <button
                type="button"
                className="button secondary small"
                onClick={() => onStartTimer(task.id)}
                disabled={task.status === 'done'}
              >
                开始计时
              </button>
            )}
            <button type="button" className="button ghost small" onClick={() => onEdit(task)}>
              编辑
            </button>
            <button
              type="button"
              className="button ghost small danger-text"
              onClick={() => {
                if (window.confirm(`确定删除任务“${task.title}”吗？`)) {
                  onDelete(task)
                }
              }}
            >
              删除
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
