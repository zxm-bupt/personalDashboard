export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'todo' | 'doing' | 'done'
export type TimeEntryType = 'focus' | 'checkin'

export interface TaskResource {
  id: string
  kind: 'url'
  title: string
  url: string
}

export interface Task {
  id: string
  title: string
  description: string
  dueAt: string | null
  priority: Priority
  status: TaskStatus
  resources: TaskResource[]
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface TimeEntry {
  id: string
  taskId: string | null
  type: TimeEntryType
  startedAt: string
  endedAt: string | null
  note: string
}

export interface Checkin {
  id: string
  date: string
  clockInAt: string
  clockOutAt: string | null
  note: string
}

export interface WorkbenchState {
  tasks: Task[]
  timeEntries: TimeEntry[]
  checkins: Checkin[]
  lastOpenedResourceId: string | null
}

export interface TaskInput {
  title: string
  description: string
  dueAt: string | null
  priority: Priority
  resources: Array<{
    id?: string
    title: string
    url: string
  }>
}

export type TaskFilter = 'all' | 'today' | 'overdue' | 'done'
export type AppSection = 'dashboard' | 'tasks' | 'time'
