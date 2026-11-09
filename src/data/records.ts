import type { Checkin, SyncMeta, SyncedRecord, Task, TimeEntry, WorkbenchState } from '../types'

// 这个文件只用 `import type`，不依赖打包器，方便 `node --test` 直接加载测试。

export function emptySyncMeta(): SyncMeta {
  return { deviceId: null, cursor: null, pushedUntil: null, lastSyncAt: null, serverId: null }
}

export function isLive(record: SyncedRecord): boolean {
  return record.deletedAt === null
}

/** 打墓碑：只标记删除时间，记录本身留着，同步时用来告诉其他设备“这条删掉了”。 */
export function tombstone<T extends SyncedRecord>(record: T, at: string): T {
  return { ...record, deletedAt: at, updatedAt: at }
}

/** 只改动未删除的记录；fn 返回新对象时自动盖上修改时间，返回原对象表示不变。 */
export function updateLive<T extends SyncedRecord>(
  records: T[],
  at: string,
  fn: (record: T) => T,
): T[] {
  return records.map((record) => {
    if (!isLive(record)) return record
    const next = fn(record)
    return next === record ? record : { ...next, updatedAt: at }
  })
}

/** 给界面用的视图：去掉墓碑。同步状态原样保留。 */
export function liveView(store: WorkbenchState): WorkbenchState {
  return {
    ...store,
    tasks: store.tasks.filter(isLive),
    timeEntries: store.timeEntries.filter(isLive),
    checkins: store.checkins.filter(isLive),
  }
}

/** 结束所有进行中的专注计时（同时只允许一段）。 */
export function endOpenFocus(entries: TimeEntry[], at: string): TimeEntry[] {
  return updateLive(entries, at, (entry) =>
    entry.type === 'focus' && !entry.endedAt ? { ...entry, endedAt: at } : entry,
  )
}

/** 结束所有进行中的打卡（同时只允许一段）。 */
export function closeOpenCheckins(checkins: Checkin[], at: string): Checkin[] {
  return updateLive(checkins, at, (checkin) =>
    !checkin.clockOutAt ? { ...checkin, clockOutAt: at } : checkin,
  )
}

/** 删除任务时，把引用它的计时记录解除关联，记录本身保留。 */
export function detachTimeEntries(
  entries: TimeEntry[],
  taskIds: Set<string>,
  at: string,
): TimeEntry[] {
  return updateLive(entries, at, (entry) =>
    entry.taskId && taskIds.has(entry.taskId) ? { ...entry, taskId: null } : entry,
  )
}

/**
 * 旧版本数据没有 updatedAt / deletedAt。按已有字段补出“最后一次被改动的时刻”：
 * 计时取结束时间（还在计时取开始时间），打卡取下班时间（还没下班取上班时间）。
 */
export function upgradeTimeEntry(entry: Partial<TimeEntry> & Pick<TimeEntry, 'startedAt'>): TimeEntry {
  return {
    ...(entry as TimeEntry),
    updatedAt: entry.updatedAt ?? entry.endedAt ?? entry.startedAt,
    deletedAt: entry.deletedAt ?? null,
  }
}

export function upgradeCheckin(checkin: Partial<Checkin> & Pick<Checkin, 'clockInAt'>): Checkin {
  return {
    ...(checkin as Checkin),
    updatedAt: checkin.updatedAt ?? checkin.clockOutAt ?? checkin.clockInAt,
    deletedAt: checkin.deletedAt ?? null,
  }
}

export function upgradeTask(task: Task): Task {
  return {
    ...task,
    deletedAt: task.deletedAt ?? null,
    resources: task.resources.map((resource) => ({
      ...resource,
      deviceId: resource.deviceId ?? null,
    })),
  }
}

/**
 * 旧版本添加的文件/应用资源没有 deviceId。它们一定是在本机添加的（那时还没有同步），
 * 所以在首次同步之前认领为本机资源；否则同步到另一台 Mac 后会被当成那台的本地文件。
 * 返回原对象表示没有需要认领的资源。
 */
export function claimLegacyResources(tasks: Task[], deviceId: string): Task[] {
  let changed = false
  const next = tasks.map((task) => {
    if (!task.resources.some((resource) => resource.kind !== 'url' && !resource.deviceId)) {
      return task
    }
    changed = true
    return {
      ...task,
      resources: task.resources.map((resource) =>
        resource.kind !== 'url' && !resource.deviceId ? { ...resource, deviceId } : resource,
      ),
    }
  })
  return changed ? next : tasks
}

/** 文件/应用资源是否属于别的设备（本机打不开，也不该在本机取消关联）。 */
export function isRemoteResource(
  resource: { kind: string; deviceId: string | null },
  localDeviceId: string | null,
): boolean {
  return (
    resource.kind !== 'url' &&
    resource.deviceId !== null &&
    localDeviceId !== null &&
    resource.deviceId !== localDeviceId
  )
}
