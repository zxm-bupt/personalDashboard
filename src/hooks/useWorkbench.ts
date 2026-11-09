import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createEmptyState } from '../storage'
import { loadWorkbench, saveWorkbench } from '../data/workbenchRepository'
import {
  claimLegacyResources,
  closeOpenCheckins,
  detachTimeEntries,
  endOpenFocus,
  isLive,
  isRemoteResource,
  liveView,
  tombstone,
  updateLive,
} from '../data/records'
import { isTauri, openExternal } from '../lib/tauri'
import type { Checkin, ResourceInput, Task, TaskInput, TaskResource, TimeEntry, WorkbenchState } from '../types'
import { createId, nowIso, toDateKey } from '../utils'

const REMOTE_RESOURCE_MESSAGE = '这个资源是在另一台设备上添加的，路径只在那台 Mac 上有效。'

/**
 * 文件/应用资源记下所属设备。编辑任务时如果资源的类型和路径都没变，沿用原来的设备；
 * 改了路径说明指向的是本机上的新文件，归本机所有。
 */
function normalizeResource(
  resource: ResourceInput,
  deviceId: string | null,
  previous: TaskResource | undefined,
): TaskResource {
  const target = resource.target.trim()
  const unchanged = previous && previous.kind === resource.kind && previous.target === target
  return {
    id: resource.id ?? createId(),
    kind: resource.kind,
    title: resource.title.trim(),
    target,
    deviceId: resource.kind === 'url' ? null : unchanged ? previous.deviceId : deviceId,
  }
}

function normalizeResources(
  inputs: ResourceInput[],
  deviceId: string | null,
  previous: TaskResource[] = [],
): TaskResource[] {
  return inputs
    .filter((resource) => resource.title.trim() && resource.target.trim())
    .map((resource) =>
      normalizeResource(
        resource,
        deviceId,
        previous.find((item) => item.id === resource.id),
      ),
    )
}

export function useWorkbench() {
  // store 含墓碑，是同步和持久化的完整数据；state 是去掉墓碑后给界面用的视图
  const [store, setStore] = useState<WorkbenchState>(() => createEmptyState())
  const [ready, setReady] = useState(false)
  const deviceId = store.sync.deviceId

  useEffect(() => {
    let cancelled = false

    loadWorkbench()
      .then((loaded) => {
        if (cancelled) return
        // 首次启动生成本机 id；旧版本添加的文件/应用资源认领为本机资源
        const ownId = loaded.sync.deviceId ?? createId()
        setStore({
          ...loaded,
          tasks: claimLegacyResources(loaded.tasks, ownId),
          sync: { ...loaded.sync, deviceId: ownId },
        })
      })
      .catch((error) => {
        console.error('加载本地数据失败', error)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return

    void saveWorkbench(store).catch((error) => {
      console.error('保存本地数据失败', error)
    })
  }, [store, ready])

  const state = useMemo(() => liveView(store), [store])

  const activeTimer = useMemo(
    () => state.timeEntries.find((entry) => entry.type === 'focus' && !entry.endedAt) ?? null,
    [state.timeEntries],
  )

  const activeCheckin = useMemo(
    () => state.checkins.find((checkin) => !checkin.clockOutAt) ?? null,
    [state.checkins],
  )

  const deviceIdRef = useRef(deviceId)
  useEffect(() => {
    deviceIdRef.current = deviceId
  })

  const createTask = useCallback((input: TaskInput) => {
    const timestamp = nowIso()
    const task: Task = {
      id: createId(),
      title: input.title.trim(),
      description: input.description.trim(),
      dueAt: input.dueAt,
      priority: input.priority,
      status: 'todo',
      resources: normalizeResources(input.resources, deviceIdRef.current),
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      completedAt: null,
    }

    setStore((previous) => ({ ...previous, tasks: [task, ...previous.tasks] }))
    return task
  }, [])

  const updateTask = useCallback((id: string, input: TaskInput) => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      tasks: updateLive(previous.tasks, timestamp, (task) =>
        task.id === id
          ? {
              ...task,
              title: input.title.trim(),
              description: input.description.trim(),
              dueAt: input.dueAt,
              priority: input.priority,
              resources: normalizeResources(input.resources, deviceIdRef.current, task.resources),
            }
          : task,
      ),
    }))
  }, [])

  const deleteTask = useCallback((id: string) => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) =>
        task.id === id && isLive(task) ? tombstone(task, timestamp) : task,
      ),
      timeEntries: detachTimeEntries(previous.timeEntries, new Set([id]), timestamp),
    }))
  }, [])

  const toggleTaskDone = useCallback((id: string) => {
    const timestamp = nowIso()
    setStore((previous) => {
      const task = previous.tasks.find((item) => item.id === id)
      const isDone = task?.status === 'done'
      return {
        ...previous,
        tasks: updateLive(previous.tasks, timestamp, (item) =>
          item.id === id
            ? {
                ...item,
                status: isDone ? 'todo' : 'done',
                completedAt: isDone ? null : timestamp,
              }
            : item,
        ),
        timeEntries: isDone ? previous.timeEntries : endOpenFocus(previous.timeEntries, timestamp),
      }
    })
  }, [])

  const startTask = useCallback((taskId: string) => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      tasks: updateLive(previous.tasks, timestamp, (task) =>
        task.id === taskId && task.status === 'todo' ? { ...task, status: 'doing' } : task,
      ),
    }))
  }, [])

  const startTimer = useCallback((taskId: string) => {
    const timestamp = nowIso()
    setStore((previous) => {
      const entry: TimeEntry = {
        id: createId(),
        taskId,
        type: 'focus',
        startedAt: timestamp,
        endedAt: null,
        note: '',
        updatedAt: timestamp,
        deletedAt: null,
      }

      return {
        ...previous,
        timeEntries: [entry, ...endOpenFocus(previous.timeEntries, timestamp)],
        tasks: updateLive(previous.tasks, timestamp, (task) =>
          task.id === taskId && task.status === 'todo' ? { ...task, status: 'doing' } : task,
        ),
      }
    })
  }, [])

  const stopTimer = useCallback(() => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      timeEntries: endOpenFocus(previous.timeEntries, timestamp),
    }))
  }, [])

  const clockIn = useCallback(() => {
    const timestamp = nowIso()
    const checkin: Checkin = {
      id: createId(),
      date: toDateKey(new Date(timestamp)),
      clockInAt: timestamp,
      clockOutAt: null,
      note: '',
      updatedAt: timestamp,
      deletedAt: null,
    }
    setStore((previous) => ({
      ...previous,
      checkins: [checkin, ...closeOpenCheckins(previous.checkins, timestamp)],
    }))
  }, [])

  const clockOut = useCallback(() => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      checkins: closeOpenCheckins(previous.checkins, timestamp),
    }))
  }, [])

  /** 补卡：插入一条历史打卡记录。date 跟随上班时间所在的那一天。 */
  const addCheckin = useCallback(
    (input: { clockInAt: string; clockOutAt: string | null; note?: string }) => {
      const timestamp = nowIso()
      const checkin: Checkin = {
        id: createId(),
        date: toDateKey(new Date(input.clockInAt)),
        clockInAt: input.clockInAt,
        clockOutAt: input.clockOutAt,
        note: input.note ?? '补卡',
        updatedAt: timestamp,
        deletedAt: null,
      }

      setStore((previous) => ({
        ...previous,
        checkins: [checkin, ...previous.checkins],
      }))
    },
    [],
  )

  /** 修改已有打卡记录的上下班时间，用来订正忘记打卡造成的错误区间。 */
  const updateCheckin = useCallback(
    (id: string, input: { clockInAt: string; clockOutAt: string | null }) => {
      const timestamp = nowIso()
      setStore((previous) => ({
        ...previous,
        checkins: updateLive(previous.checkins, timestamp, (checkin) =>
          checkin.id === id
            ? {
                ...checkin,
                date: toDateKey(new Date(input.clockInAt)),
                clockInAt: input.clockInAt,
                clockOutAt: input.clockOutAt,
              }
            : checkin,
        ),
      }))
    },
    [],
  )

  const updateResourceTitle = useCallback((taskId: string, resourceId: string, title: string) => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      tasks: updateLive(previous.tasks, timestamp, (task) =>
        task.id === taskId
          ? {
              ...task,
              resources: task.resources.map((resource) =>
                resource.id === resourceId ? { ...resource, title } : resource,
              ),
            }
          : task,
      ),
    }))
  }, [])

  const addFocusSession = useCallback(
    (input: { taskId: string | null; startedAt: string; endedAt: string; note?: string }) => {
      const timestamp = nowIso()
      const entry: TimeEntry = {
        id: createId(),
        taskId: input.taskId,
        type: 'focus',
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        note: input.note ?? '番茄钟',
        updatedAt: timestamp,
        deletedAt: null,
      }

      setStore((previous) => ({
        ...previous,
        timeEntries: [entry, ...previous.timeEntries],
        tasks: input.taskId
          ? updateLive(previous.tasks, timestamp, (task) =>
              task.id === input.taskId && task.status === 'todo'
                ? { ...task, status: 'doing' }
                : task,
            )
          : previous.tasks,
      }))
    },
    [],
  )

  const removeResources = useCallback((taskId: string, resourceIds: Set<string>) => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      tasks: updateLive(previous.tasks, timestamp, (task) =>
        task.id === taskId
          ? { ...task, resources: task.resources.filter((resource) => !resourceIds.has(resource.id)) }
          : task,
      ),
    }))
  }, [])

  const deleteTimeEntry = useCallback((timeEntryId: string) => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      timeEntries: previous.timeEntries.map((entry) =>
        entry.id === timeEntryId && isLive(entry) ? tombstone(entry, timestamp) : entry,
      ),
    }))
  }, [])

  const deleteCheckin = useCallback((checkinId: string) => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      checkins: previous.checkins.map((checkin) =>
        checkin.id === checkinId && isLive(checkin) ? tombstone(checkin, timestamp) : checkin,
      ),
    }))
  }, [])

  // 清空也是打墓碑：直接清掉的话，另一台设备同步回来时这些记录又会出现
  const clearTasks = useCallback(() => {
    const timestamp = nowIso()
    setStore((previous) => {
      const cleared = new Set(previous.tasks.filter(isLive).map((task) => task.id))
      return {
        ...previous,
        tasks: previous.tasks.map((task) => (isLive(task) ? tombstone(task, timestamp) : task)),
        timeEntries: detachTimeEntries(previous.timeEntries, cleared, timestamp),
      }
    })
  }, [])

  const clearTimeEntries = useCallback(() => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      timeEntries: previous.timeEntries.map((entry) =>
        isLive(entry) ? tombstone(entry, timestamp) : entry,
      ),
    }))
  }, [])

  const clearCheckins = useCallback(() => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      checkins: previous.checkins.map((checkin) =>
        isLive(checkin) ? tombstone(checkin, timestamp) : checkin,
      ),
    }))
  }, [])

  // 只属于本机，不改 updatedAt，也不参与同步
  const markResourceOpened = useCallback((resourceId: string) => {
    setStore((previous) => ({ ...previous, lastOpenedResourceId: resourceId }))
  }, [])

  const openTaskResource = useCallback(
    async (taskId: string, resource: TaskResource) => {
      if (isRemoteResource(resource, deviceIdRef.current)) {
        window.alert(REMOTE_RESOURCE_MESSAGE)
        return
      }

      markResourceOpened(resource.id)

      if (resource.kind === 'url') {
        await openExternal(resource.target)
        return
      }

      if (!isTauri()) {
        window.alert('本地文件和软件只能在桌面版中打开。')
        return
      }

      try {
        await invoke('open_resource', {
          kind: resource.kind,
          target: resource.target,
        })
      } catch (error) {
        const message = String(error)

        if (message.includes('RESOURCE_NOT_FOUND')) {
          const shouldRemove = window.confirm(
            `资源“${resource.title}”不存在或已被删除，是否取消它与当前任务的关联？`,
          )
          if (shouldRemove) removeResources(taskId, new Set([resource.id]))
          return
        }

        window.alert(`打开资源失败：${message}`)
      }
    },
    [markResourceOpened, removeResources],
  )

  const openAllTaskResources = useCallback(
    async (task: Task) => {
      const missing: TaskResource[] = []
      let skippedRemote = 0

      for (const resource of task.resources) {
        // 其他设备上的文件路径在本机不存在，跳过，也不能提示取消关联
        if (isRemoteResource(resource, deviceIdRef.current)) {
          skippedRemote += 1
          continue
        }

        markResourceOpened(resource.id)

        if (resource.kind === 'url') {
          try {
            await openExternal(resource.target)
          } catch (error) {
            console.error('打开网页资源失败', error)
          }
          continue
        }

        if (!isTauri()) {
          continue
        }

        try {
          await invoke('open_resource', {
            kind: resource.kind,
            target: resource.target,
          })
        } catch (error) {
          const message = String(error)
          if (message.includes('RESOURCE_NOT_FOUND')) {
            missing.push(resource)
          } else {
            console.error('打开本地资源失败', message)
          }
        }
      }

      if (missing.length > 0) {
        const shouldRemove = window.confirm(
          `以下资源不存在或已被删除，是否取消它们与当前任务的关联？\n\n${missing
            .map((resource) => `· ${resource.title}`)
            .join('\n')}`,
        )

        if (shouldRemove) {
          removeResources(task.id, new Set(missing.map((resource) => resource.id)))
        }
      } else if (skippedRemote > 0) {
        window.alert(`有 ${skippedRemote} 个资源是在其他设备上添加的，已跳过。`)
      }
    },
    [markResourceOpened, removeResources],
  )

  const exportData = useCallback(() => {
    // 导出给人看的备份：不含墓碑和本机同步状态
    const { sync: _sync, ...exported } = state
    void _sync
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `personal-workbench-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [state])

  const clearAll = useCallback(() => {
    const timestamp = nowIso()
    setStore((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) => (isLive(task) ? tombstone(task, timestamp) : task)),
      timeEntries: previous.timeEntries.map((entry) =>
        isLive(entry) ? tombstone(entry, timestamp) : entry,
      ),
      checkins: previous.checkins.map((checkin) =>
        isLive(checkin) ? tombstone(checkin, timestamp) : checkin,
      ),
      lastOpenedResourceId: null,
    }))
  }, [])

  /** 给同步引擎用：在最新的完整数据（含墓碑）上应用一次更新。 */
  const updateStore = useCallback((updater: (previous: WorkbenchState) => WorkbenchState) => {
    setStore(updater)
  }, [])

  return {
    state,
    store,
    ready,
    deviceId,
    updateStore,
    activeTimer,
    activeCheckin,
    createTask,
    updateTask,
    deleteTask,
    toggleTaskDone,
    startTask,
    startTimer,
    stopTimer,
    clockIn,
    clockOut,
    addCheckin,
    updateCheckin,
    updateResourceTitle,
    addFocusSession,
    deleteTimeEntry,
    deleteCheckin,
    clearTasks,
    clearTimeEntries,
    clearCheckins,
    markResourceOpened,
    openTaskResource,
    openAllTaskResources,
    exportData,
    clearAll,
  }
}
