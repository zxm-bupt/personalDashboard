import { useCallback, useEffect, useMemo, useState } from 'react'
import { createEmptyState } from '../storage'
import { loadWorkbench, saveWorkbench } from '../data/workbenchRepository'
import type { Checkin, Task, TaskInput, TimeEntry, WorkbenchState } from '../types'
import { createId, nowIso, toDateKey } from '../utils'

function endOpenFocus(entries: TimeEntry[], at: string): TimeEntry[] {
  return entries.map((entry) =>
    entry.type === 'focus' && !entry.endedAt ? { ...entry, endedAt: at } : entry,
  )
}

export function useWorkbench() {
  const [state, setState] = useState<WorkbenchState>(() => createEmptyState())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    loadWorkbench()
      .then((loaded) => {
        if (!cancelled) setState(loaded)
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

    void saveWorkbench(state).catch((error) => {
      console.error('保存本地数据失败', error)
    })
  }, [state, ready])

  const activeTimer = useMemo(
    () => state.timeEntries.find((entry) => entry.type === 'focus' && !entry.endedAt) ?? null,
    [state.timeEntries],
  )

  const activeCheckin = useMemo(
    () => state.checkins.find((checkin) => !checkin.clockOutAt) ?? null,
    [state.checkins],
  )

  const createTask = useCallback((input: TaskInput) => {
    const timestamp = nowIso()
    const task: Task = {
      id: createId(),
      title: input.title.trim(),
      description: input.description.trim(),
      dueAt: input.dueAt,
      priority: input.priority,
      status: 'todo',
      resources: input.resources
        .filter((resource) => resource.title.trim() && resource.url.trim())
        .map((resource) => ({
          id: resource.id ?? createId(),
          kind: 'url' as const,
          title: resource.title.trim(),
          url: resource.url.trim(),
        })),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }

    setState((previous) => ({ ...previous, tasks: [task, ...previous.tasks] }))
    return task
  }, [])

  const updateTask = useCallback((id: string, input: TaskInput) => {
    setState((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) => {
        if (task.id !== id) return task
        return {
          ...task,
          title: input.title.trim(),
          description: input.description.trim(),
          dueAt: input.dueAt,
          priority: input.priority,
          resources: input.resources
            .filter((resource) => resource.title.trim() && resource.url.trim())
            .map((resource) => ({
              id: resource.id ?? createId(),
              kind: 'url' as const,
              title: resource.title.trim(),
              url: resource.url.trim(),
            })),
          updatedAt: nowIso(),
        }
      }),
    }))
  }, [])

  const deleteTask = useCallback((id: string) => {
    setState((previous) => ({
      ...previous,
      tasks: previous.tasks.filter((task) => task.id !== id),
      timeEntries: previous.timeEntries.map((entry) =>
        entry.taskId === id ? { ...entry, taskId: null } : entry,
      ),
    }))
  }, [])

  const toggleTaskDone = useCallback((id: string) => {
    const timestamp = nowIso()
    setState((previous) => {
      const task = previous.tasks.find((item) => item.id === id)
      const isDone = task?.status === 'done'
      return {
        ...previous,
        tasks: previous.tasks.map((item) =>
          item.id === id
            ? {
                ...item,
                status: isDone ? 'todo' : 'done',
                completedAt: isDone ? null : timestamp,
                updatedAt: timestamp,
              }
            : item,
        ),
        timeEntries: isDone ? previous.timeEntries : endOpenFocus(previous.timeEntries, timestamp),
      }
    })
  }, [])

  const startTimer = useCallback((taskId: string) => {
    const timestamp = nowIso()
    setState((previous) => {
      const nextEntries = endOpenFocus(previous.timeEntries, timestamp)
      const entry: TimeEntry = {
        id: createId(),
        taskId,
        type: 'focus',
        startedAt: timestamp,
        endedAt: null,
        note: '',
      }

      return {
        ...previous,
        timeEntries: [entry, ...nextEntries],
        tasks: previous.tasks.map((task) =>
          task.id === taskId && task.status === 'todo'
            ? { ...task, status: 'doing', updatedAt: timestamp }
            : task,
        ),
      }
    })
  }, [])

  const stopTimer = useCallback(() => {
    const timestamp = nowIso()
    setState((previous) => ({
      ...previous,
      timeEntries: previous.timeEntries.map((entry) =>
        entry.type === 'focus' && !entry.endedAt
          ? { ...entry, endedAt: timestamp }
          : entry,
      ),
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
    }
    setState((previous) => ({
      ...previous,
      checkins: [checkin, ...previous.checkins.map((item) =>
        !item.clockOutAt ? { ...item, clockOutAt: timestamp } : item,
      )],
    }))
  }, [])

  const clockOut = useCallback(() => {
    const timestamp = nowIso()
    setState((previous) => ({
      ...previous,
      checkins: previous.checkins.map((item) =>
        !item.clockOutAt ? { ...item, clockOutAt: timestamp } : item,
      ),
    }))
  }, [])

  const updateResourceTitle = useCallback((taskId: string, resourceId: string, title: string) => {
    setState((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) =>
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
      const entry: TimeEntry = {
        id: createId(),
        taskId: input.taskId,
        type: 'focus',
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        note: input.note ?? '番茄钟',
      }

      setState((previous) => ({
        ...previous,
        timeEntries: [entry, ...previous.timeEntries],
        tasks: input.taskId
          ? previous.tasks.map((task) =>
              task.id === input.taskId && task.status === 'todo'
                ? { ...task, status: 'doing', updatedAt: input.endedAt }
                : task,
            )
          : previous.tasks,
      }))
    },
    [],
  )

  const markResourceOpened = useCallback((resourceId: string) => {
    setState((previous) => ({ ...previous, lastOpenedResourceId: resourceId }))
  }, [])

  const exportData = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
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
    setState(createEmptyState())
  }, [])

  return {
    state,
    activeTimer,
    activeCheckin,
    createTask,
    updateTask,
    deleteTask,
    toggleTaskDone,
    startTimer,
    stopTimer,
    clockIn,
    clockOut,
    updateResourceTitle,
    addFocusSession,
    markResourceOpened,
    exportData,
    clearAll,
  }
}
