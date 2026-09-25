import type { Priority, Task, TimeEntry } from './types'

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
