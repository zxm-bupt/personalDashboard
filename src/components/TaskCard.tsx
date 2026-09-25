import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Task, TaskResource } from '../types'
import { formatDueLabel, isOverdue, prefersReducedMotion, priorityMeta } from '../utils'

/** 与 index.css 中 task-drop-out / task-drop-in 共用的动画时长。 */
const MOTION_DURATION_MS = 340

type CompletionPhase = 'idle' | 'completing' | 'settling'

interface TaskCardProps {
  task: Task
  compact?: boolean
  mode?: 'timer' | 'status' | 'none'
  activeTimerTaskId: string | null
  onStartTimer?: (taskId: string) => void
  onStopTimer?: () => void
  onStartTask?: (taskId: string) => void
  onToggleDone: (taskId: string) => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onOpenResource?: (taskId: string, resource: TaskResource) => void
  onOpenAllResources?: (task: Task) => void
}

export function TaskCard({
  task,
  compact = false,
  mode = 'timer',
  activeTimerTaskId,
  onStartTimer,
  onStopTimer,
  onStartTask,
  onToggleDone,
  onEdit,
  onDelete,
  onOpenResource,
  onOpenAllResources,
}: TaskCardProps) {
  const isActive = activeTimerTaskId === task.id
  const overdue = isOverdue(task)

  const [completionPhase, setCompletionPhase] = useState<CompletionPhase>('idle')
  const timeoutsRef = useRef<number[]>([])
  const pendingCompletionRef = useRef<(() => void) | null>(null)

  const clearMotionTimers = () => {
    timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    timeoutsRef.current = []
  }

  useEffect(
    () => () => {
      // 卸载时取消动画节奏，但仍要落库已经触发的完成操作
      clearMotionTimers()
      pendingCompletionRef.current?.()
      pendingCompletionRef.current = null
    },
    [],
  )

  const handleToggleDone = () => {
    // 滑出过程中忽略重复点击，落位动画则可以直接打断
    if (completionPhase === 'completing') return
    clearMotionTimers()
    setCompletionPhase('idle')

    if (task.status === 'done' || prefersReducedMotion()) {
      onToggleDone(task.id)
      return
    }

    const commit = () => {
      pendingCompletionRef.current = null
      onToggleDone(task.id)
    }
    pendingCompletionRef.current = commit

    setCompletionPhase('completing')
    timeoutsRef.current.push(
      window.setTimeout(() => {
        commit()
        setCompletionPhase('settling')
        timeoutsRef.current.push(
          window.setTimeout(() => setCompletionPhase('idle'), MOTION_DURATION_MS),
        )
      }, MOTION_DURATION_MS),
    )
  }

  return (
    <article
      className={[
        'task-card',
        `priority-${task.priority}`,
        task.status === 'done' ? 'is-done' : '',
        compact ? 'compact' : '',
        completionPhase === 'completing' ? 'is-completing' : '',
        completionPhase === 'settling' ? 'is-settling' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--task-motion-duration': `${MOTION_DURATION_MS}ms` } as CSSProperties}
    >
      <button
        type="button"
        className={task.status === 'done' ? 'task-check checked' : 'task-check'}
        aria-label={task.status === 'done' ? '标记为未完成' : '标记为完成'}
        onClick={handleToggleDone}
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
              <button
                key={resource.id}
                type="button"
                className="resource-chip"
                onClick={() => onOpenResource?.(task.id, resource)}
              >
                {resource.kind === 'url' ? '↗' : resource.kind === 'file' ? '▤' : '▣'}{' '}
                {resource.title}
              </button>
            ))}
          </div>
        )}

        {!compact && (
          <div className="task-actions">
            {mode !== 'none' && (
              mode === 'status' ? (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => onStartTask?.(task.id)}
                  disabled={task.status !== 'todo'}
                >
                  {task.status === 'doing' ? '进行中' : '开始'}
                </button>
              ) : isActive ? (
                <button type="button" className="button primary small" onClick={onStopTimer}>
                  停止计时
                </button>
              ) : (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => onStartTimer?.(task.id)}
                  disabled={task.status === 'done' || !onStartTimer}
                >
                  开始计时
                </button>
              )
            )}
            <button
              type="button"
              className="button ghost small"
              onClick={() => onOpenAllResources?.(task)}
              disabled={task.resources.length === 0}
            >
              打开全部
            </button>
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
