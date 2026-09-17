import type { WorkbenchState } from './types'
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
            url: 'https://vite.dev',
          },
        ],
        createdAt: now,
        updatedAt: now,
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
            url: 'https://react.dev',
          },
        ],
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
    ],
    timeEntries: [],
    checkins: [],
    lastOpenedResourceId: null,
  }
}

export function loadState(): WorkbenchState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedState()
    const parsed = JSON.parse(raw) as Partial<WorkbenchState>
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      timeEntries: Array.isArray(parsed.timeEntries) ? parsed.timeEntries : [],
      checkins: Array.isArray(parsed.checkins) ? parsed.checkins : [],
      lastOpenedResourceId: parsed.lastOpenedResourceId ?? null,
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
  }
}

export function todayKey(): string {
  return toDateKey(new Date())
}
