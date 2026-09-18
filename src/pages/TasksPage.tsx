import { useMemo, useState } from 'react'
import { TaskCard } from '../components/TaskCard'
import type { Task, TaskFilter, TaskResource } from '../types'
import { isOverdue, isToday, sortTasks } from '../utils'

interface TasksPageProps {
  tasks: Task[]
  activeTimerTaskId: string | null
  onStartTask: (taskId: string) => void
  onClearTasks: () => void
  onToggleDone: (taskId: string) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (task: Task) => void
  onOpenResource: (taskId: string, resource: TaskResource) => void
  onOpenAllResources: (task: Task) => void
  onNewTask: () => void
}

const filters: Array<{ id: TaskFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今天' },
  { id: 'overdue', label: '逾期' },
  { id: 'done', label: '已完成' },
]

export function TasksPage({
  tasks,
  activeTimerTaskId,
  onStartTask,
  onClearTasks,
  onToggleDone,
  onEditTask,
  onDeleteTask,
  onOpenResource,
  onOpenAllResources,
  onNewTask,
}: TasksPageProps) {
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [keyword, setKeyword] = useState('')

  const filteredTasks = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    return sortTasks(
      tasks.filter((task) => {
        const matchesFilter =
          filter === 'all' ||
          (filter === 'today' && (isToday(task.dueAt) || task.status === 'doing')) ||
          (filter === 'overdue' && isOverdue(task)) ||
          (filter === 'done' && task.status === 'done')

        if (!matchesFilter) return false
        if (!normalizedKeyword) return true

        return (
          task.title.toLowerCase().includes(normalizedKeyword) ||
          task.description.toLowerCase().includes(normalizedKeyword) ||
          task.resources.some((resource) =>
            `${resource.title} ${resource.target}`.toLowerCase().includes(normalizedKeyword),
          )
        )
      }),
    )
  }, [filter, keyword, tasks])

  return (
    <div className="single-column">
      <div className="toolbar">
        <div className="filter-tabs">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? 'filter-tab active' : 'filter-tab'}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="toolbar-actions">
          <input
            className="search-input"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索任务或资源"
          />
          <button
            type="button"
            className="button ghost danger-text"
            onClick={() => {
              if (window.confirm('确定清空所有任务吗？时间记录和打卡记录会保留。')) {
                onClearTasks()
              }
            }}
          >
            清空任务
          </button>
          <button type="button" className="button primary" onClick={onNewTask}>
            + 新建任务
          </button>
        </div>
      </div>

      <div className="task-list">
        {filteredTasks.length > 0 ? (
          filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              mode="status"
              activeTimerTaskId={activeTimerTaskId}
              onStartTask={onStartTask}
              onToggleDone={onToggleDone}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
              onOpenResource={onOpenResource}
              onOpenAllResources={onOpenAllResources}
            />
          ))
        ) : (
          <div className="empty-state">
            <strong>没有符合条件的任务</strong>
            <p>换个筛选条件，或者创建一个新任务。</p>
          </div>
        )}
      </div>
    </div>
  )
}
