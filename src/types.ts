export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'todo' | 'doing' | 'done'
export type TimeEntryType = 'focus' | 'checkin'

export type ResourceKind = 'url' | 'file' | 'app'

export interface TaskResource {
  id: string
  kind: ResourceKind
  title: string
  target: string
  /**
   * 添加这个文件/应用资源的设备。路径是那台 Mac 上的绝对路径，换一台设备通常不存在，
   * 所以只有本机添加的资源才能打开或取消关联。网页链接不需要，为 null。
   */
  deviceId: string | null
}

/**
 * 参与同步的记录都带这两个字段：updatedAt 是最后一次修改的时刻，用于判断哪边更新；
 * deletedAt 不为 null 表示已删除（墓碑）。删除只打标记，不真正移除，否则另一台设备
 * 合并时会把它“复活”。界面只显示 deletedAt === null 的记录。
 */
export interface SyncedRecord {
  updatedAt: string
  deletedAt: string | null
}

export interface Task extends SyncedRecord {
  id: string
  title: string
  description: string
  dueAt: string | null
  priority: Priority
  status: TaskStatus
  resources: TaskResource[]
  createdAt: string
  completedAt: string | null
}

export interface TimeEntry extends SyncedRecord {
  id: string
  taskId: string | null
  type: TimeEntryType
  startedAt: string
  endedAt: string | null
  note: string
}

export interface Checkin extends SyncedRecord {
  id: string
  date: string
  clockInAt: string
  clockOutAt: string | null
  note: string
}

/** 只属于本机的同步状态，本身不参与同步。和业务数据在同一个事务里保存。 */
export interface SyncMeta {
  /** 本机 id，首次启动时生成。 */
  deviceId: string | null
  /** 已经从服务器拿到的最大序号。null 表示还没同步过。 */
  cursor: number | null
  /** 推送水位线：上次成功同步开始的时刻，之后改过的记录下次要推送。 */
  pushedUntil: string | null
  lastSyncAt: string | null
  /** 上次同步的服务器数据库 id。变了说明服务器数据被重建，要全量重新同步。 */
  serverId: string | null
}

export interface WorkbenchState {
  tasks: Task[]
  timeEntries: TimeEntry[]
  checkins: Checkin[]
  lastOpenedResourceId: string | null
  sync: SyncMeta
}

export interface ResourceInput {
  id?: string
  kind: ResourceKind
  title: string
  target: string
}

export interface TaskInput {
  title: string
  description: string
  dueAt: string | null
  priority: Priority
  resources: ResourceInput[]
}

export type TaskFilter = 'all' | 'today' | 'overdue' | 'done'
export type AppSection = 'dashboard' | 'tasks' | 'time'
