import { emptySyncMeta, upgradeCheckin, upgradeTask, upgradeTimeEntry } from './data/records'
import type { Checkin, ResourceKind, Task, TimeEntry, WorkbenchState } from './types'
import { createId, nowIso, toDateKey } from './utils'

const STORAGE_KEY = 'personal-workbench:v1'

function createSeedState(): WorkbenchState {
  const now = nowIso()
  return {
    tasks: [
      {
        id: createId(),
        title: '欢迎使用个人工作台',
        description: '在任务页添加任务，指定 DDL、优先级和网页链接资源。',
        dueAt: null,
        priority: 'medium',
        status: 'todo',
        resources: [
          {
            id: createId(),
            kind: 'url',
            title: 'Vite 文档',
            target: 'https://vite.dev',
            deviceId: null,
          },
        ],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        completedAt: null,
      },
      {
        id: createId(),
        title: '体验打卡和任务计时',
        description: '进入时间页打卡，或在任务卡片上点击“开始计时”。',
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        priority: 'high',
        status: 'todo',
        resources: [
          {
            id: createId(),
            kind: 'url',
            title: 'React 文档',
            target: 'https://react.dev',
            deviceId: null,
          },
        ],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        completedAt: null,
      },
    ],
    timeEntries: [],
    checkins: [],
    lastOpenedResourceId: null,
    sync: emptySyncMeta(),
  }
}

export function loadState(): WorkbenchState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedState()
    const parsed = JSON.parse(raw) as Partial<WorkbenchState>
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map((task) => {
          const legacyTask = task as unknown as {
            resources?: Array<{
              id?: string
              kind?: string
              title?: string
              target?: string
              url?: string
              deviceId?: string | null
            }>
          }

          return upgradeTask({
            ...task,
            resources: Array.isArray(legacyTask.resources)
              ? legacyTask.resources
                  .map((resource) => ({
                    id: resource.id ?? createId(),
                    kind: (resource.kind === 'file' || resource.kind === 'app'
                      ? resource.kind
                      : 'url') as ResourceKind,
                    title: resource.title ?? '',
                    target: resource.target ?? resource.url ?? '',
                    deviceId: resource.deviceId ?? null,
                  }))
                  .filter((resource) => resource.title || resource.target)
              : [],
          } as Task)
        })
      : []

    // 旧版本的记录没有 updatedAt / deletedAt，读取时按已有字段补上
    return {
      tasks,
      timeEntries: Array.isArray(parsed.timeEntries)
        ? parsed.timeEntries.map((entry: TimeEntry) => upgradeTimeEntry(entry))
        : [],
      checkins: Array.isArray(parsed.checkins)
        ? parsed.checkins.map((checkin: Checkin) => upgradeCheckin(checkin))
        : [],
      lastOpenedResourceId: parsed.lastOpenedResourceId ?? null,
      sync: { ...emptySyncMeta(), ...parsed.sync },
    }
  } catch {
    return createSeedState()
  }
}

export function saveState(state: WorkbenchState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.warn('无法保存工作台数据', error)
  }
}

export function createEmptyState(): WorkbenchState {
  return {
    tasks: [],
    timeEntries: [],
    checkins: [],
    lastOpenedResourceId: null,
    sync: emptySyncMeta(),
  }
}

export function todayKey(): string {
  return toDateKey(new Date())
}
