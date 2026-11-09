import type { RecordKind, SyncRecord } from './protocol.ts'

interface LiveSource {
  live(kind: RecordKind): SyncRecord[]
}

interface OpenRule {
  kind: RecordKind
  /** 这条记录是不是“进行中”的那一段。 */
  isOpen(data: Record<string, unknown>): boolean
  startField: string
  endField: string
}

/**
 * 客户端各自保证“同时只有一段进行中的打卡/专注计时”，但两台 Mac 离线时各打了一次上班卡，
 * 合并后就会出现两段进行中的打卡。修复方式和本机上班打卡一致：保留开始得最晚的一段，
 * 其余各段在它开始的时刻结束。
 */
const OPEN_RULES: OpenRule[] = [
  {
    kind: 'checkin',
    isOpen: (data) => data.clockOutAt == null,
    startField: 'clockInAt',
    endField: 'clockOutAt',
  },
  {
    kind: 'timeEntry',
    isOpen: (data) => data.type === 'focus' && data.endedAt == null,
    startField: 'startedAt',
    endField: 'endedAt',
  },
]

function startTime(record: SyncRecord, field: string): number {
  const value = record.data[field]
  return typeof value === 'string' ? Date.parse(value) : 0
}

/**
 * 修复后的修改时间必须比所有涉及记录都新，否则时钟偏快的设备下次推送时，
 * 它本地那份“仍在进行中”的旧版本会赢回去，形成来回覆盖。
 */
function repairStamp(involved: SyncRecord[], now: Date): string {
  const latest = Math.max(...involved.map((record) => Date.parse(record.updatedAt)))
  return new Date(Math.max(now.getTime(), latest + 1)).toISOString()
}

export function repairInvariants(source: LiveSource, now: Date): SyncRecord[] {
  const fixed: SyncRecord[] = []

  for (const rule of OPEN_RULES) {
    const open = source
      .live(rule.kind)
      .filter((record) => rule.isOpen(record.data))
      .sort((a, b) => startTime(b, rule.startField) - startTime(a, rule.startField))

    if (open.length < 2) continue

    const [newest, ...older] = open
    const closedAt = newest.data[rule.startField]
    const stamp = repairStamp(open, now)

    for (const record of older) {
      fixed.push({
        ...record,
        updatedAt: stamp,
        data: { ...record.data, [rule.endField]: closedAt, updatedAt: stamp },
      })
    }
  }

  return fixed
}
