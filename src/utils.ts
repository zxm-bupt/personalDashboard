import type { Checkin, Priority, Task, TimeEntry } from './types'

export const priorityMeta: Record<Priority, { label: string; rank: number }> = {
  urgent: { label: '紧急', rank: 4 },
  high: { label: '高', rank: 3 },
  medium: { label: '中', rank: 2 },
  low: { label: '低', rank: 1 },
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function toDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isToday(iso: string | null): boolean {
  if (!iso) return false
  return toDateKey(iso) === toDateKey(new Date())
}

export function isOverdue(task: Task): boolean {
  if (!task.dueAt || task.status === 'done') return false
  return new Date(task.dueAt).getTime() < Date.now()
}

export function isDueSoon(iso: string | null, days = 7): boolean {
  if (!iso) return false
  const due = new Date(iso).getTime()
  const now = Date.now()
  const end = now + days * 24 * 60 * 60 * 1000
  return due >= now && due <= end
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '未设置 DDL'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function formatDate(iso: string | null): string {
  if (!iso) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso))
}

export function formatFullDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0')
  const rest = (safe % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`
}

export function durationSeconds(startedAt: string, endedAt?: string | null): number {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  return Math.max(0, Math.round((end - start) / 1000))
}

/**
 * 当天打卡状态。用可辨识联合表达三种情况，避免把“已下班”和“还没打卡”
 * 都退化成 activeCheckin === null。
 *
 * 这里是“正在进行”的实时视角：跨夜还没关闭的那一段会被折进“今天”，
 * 工作中的时长用 now 实时计算——这部分行为由 v0.5.3 的修复保证，仪表盘 /
 * 时间页 / 托盘都要看到实时累加的数字，不受“忘记打下班卡的历史记录按 0
 * 计算”规则的影响。那条规则只用于下面的 summarizeCompletedCheckins，
 * 给本月统计、打卡历史这类回顾性汇总用。
 */
export type CheckinSummary =
  | { status: 'none' }
  | { status: 'working'; firstClockInAt: string; workedSeconds: number }
  | {
      status: 'finished'
      firstClockInAt: string
      lastClockOutAt: string
      workedSeconds: number
    }

export function summarizeCheckins(
  checkins: Checkin[],
  dateKey: string = toDateKey(new Date()),
): CheckinSummary {
  // 进行中的打卡可能是前一天开始的，按“当前这一段”一并算进来
  const relevant = checkins.filter(
    (checkin) => checkin.date === dateKey || !checkin.clockOutAt,
  )

  if (relevant.length === 0) return { status: 'none' }

  const workedSeconds = relevant.reduce(
    (total, checkin) => total + durationSeconds(checkin.clockInAt, checkin.clockOutAt),
    0,
  )
  const firstClockInAt = relevant.reduce(
    (earliest, checkin) =>
      new Date(checkin.clockInAt).getTime() < new Date(earliest).getTime()
        ? checkin.clockInAt
        : earliest,
    relevant[0].clockInAt,
  )

  const open = relevant.find((checkin) => !checkin.clockOutAt)
  if (open) return { status: 'working', firstClockInAt, workedSeconds }

  // 走到这里说明每一段都有下班时间
  const lastClockOutAt = relevant.reduce((latest, checkin) => {
    const clockOutAt = checkin.clockOutAt ?? latest
    return new Date(clockOutAt).getTime() > new Date(latest).getTime() ? clockOutAt : latest
  }, relevant[0].clockOutAt as string)

  return { status: 'finished', firstClockInAt, lastClockOutAt, workedSeconds }
}

/**
 * 只保留已经打了下班卡的记录——用于本月统计、打卡历史这类回顾性汇总。
 * 一条记录如果忘记打下班卡，在这类汇总里按“当天没有发生”处理（计 0），
 * 而不是用 durationSeconds 的 now 兜底去累加到现在，否则忘记打卡的天数
 * 越多，统计数字会无限膨胀。正在进行中的当前这一段同样会被排除——它的
 * 实时时长只在 summarizeCheckins 驱动的仪表盘 / 时间页 / 托盘里展示。
 */
export function summarizeCompletedCheckins(checkins: Checkin[]): {
  checkins: Checkin[]
  totalSeconds: number
  days: number
} {
  const completed = checkins.filter((checkin): checkin is Checkin & { clockOutAt: string } =>
    Boolean(checkin.clockOutAt),
  )
  const totalSeconds = completed.reduce(
    (total, checkin) => total + durationSeconds(checkin.clockInAt, checkin.clockOutAt),
    0,
  )
  const days = new Set(completed.map((checkin) => checkin.date)).size

  return { checkins: completed, totalSeconds, days }
}

/** ISO 时间戳转成 <input type="time"> 需要的本地 HH:mm。 */
export function toTimeInputValue(iso: string): string {
  const date = new Date(iso)
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 把 2026-10-16 + 09:30 合成本地时间的 ISO 字符串，格式不合法时返回 null。 */
export function combineDateAndTime(dateKey: string, time: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) return null

  const [, year, month, day] = dateMatch
  const [, hours, minutes] = timeMatch
  if (Number(hours) > 23 || Number(minutes) > 59) return null

  const composed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    0,
    0,
  )
  if (Number.isNaN(composed.getTime())) return null
  return composed.toISOString()
}

export function shiftIsoByDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * 找出与给定区间重叠的打卡记录。补卡时用来防止同一段时间被记两次。
 * 没有下班时间的记录视为延伸到无穷远。
 */
export function findCheckinOverlap(
  checkins: Checkin[],
  range: { clockInAt: string; clockOutAt: string | null },
  ignoreId?: string,
): Checkin | null {
  const start = new Date(range.clockInAt).getTime()
  const end = range.clockOutAt ? new Date(range.clockOutAt).getTime() : Number.POSITIVE_INFINITY

  return (
    checkins.find((checkin) => {
      if (checkin.id === ignoreId) return false
      const otherStart = new Date(checkin.clockInAt).getTime()
      const otherEnd = checkin.clockOutAt
        ? new Date(checkin.clockOutAt).getTime()
        : Number.POSITIVE_INFINITY
      // 首尾相接不算重叠
      return start < otherEnd && otherStart < end
    }) ?? null
  )
}

export function formatDueLabel(iso: string | null, done: boolean): string {
  if (!iso) return '无 DDL'
  if (done) return `完成于 ${formatDate(iso)}`
  const due = new Date(iso)
  if (due.getTime() < Date.now()) return `已逾期 ${formatDate(iso)}`
  if (isToday(iso)) return `今天 ${formatTime(iso)}`
  return formatDateTime(iso)
}

export function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

export function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null
  return new Date(value).toISOString()
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1
    if (a.status !== 'done' && b.status === 'done') return -1
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    if (a.dueAt) return -1
    if (b.dueAt) return 1
    return priorityMeta[b.priority].rank - priorityMeta[a.priority].rank
  })
}

export function sortTimeEntries(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )
}
