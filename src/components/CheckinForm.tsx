import { useState } from 'react'
import type { Checkin } from '../types'
import {
  combineDateAndTime,
  findCheckinOverlap,
  formatDuration,
  shiftIsoByDays,
  toDateKey,
  toTimeInputValue,
} from '../utils'

export interface CheckinFormValue {
  clockInAt: string
  clockOutAt: string | null
}

interface CheckinFormProps {
  open: boolean
  /** 传入记录表示订正，留空表示新增补卡。 */
  checkin: Checkin | null
  /** 用于重叠校验，包含待编辑的那条。 */
  checkins: Checkin[]
  onClose: () => void
  onSubmit: (value: CheckinFormValue) => void
}

export function CheckinForm({
  open,
  checkin,
  checkins,
  onClose,
  onSubmit,
}: CheckinFormProps) {
  const [date, setDate] = useState(() => checkin?.date ?? toDateKey(new Date()))
  const [clockInTime, setClockInTime] = useState(() =>
    checkin ? toTimeInputValue(checkin.clockInAt) : '09:00',
  )
  const [clockOutTime, setClockOutTime] = useState(() =>
    checkin?.clockOutAt ? toTimeInputValue(checkin.clockOutAt) : '18:00',
  )
  const [stillWorking, setStillWorking] = useState(
    () => Boolean(checkin) && !checkin?.clockOutAt,
  )
  const [error, setError] = useState('')
  // 打开表单时固定一个“现在”，渲染期间不再读时钟，预览才不会每次重渲染都跳动
  const [openedAt] = useState(() => Date.now())

  if (!open) return null

  const today = toDateKey(new Date(openedAt))

  const buildValue = (now: number): { value?: CheckinFormValue; error?: string } => {
    const clockInAt = combineDateAndTime(date, clockInTime)
    if (!clockInAt) return { error: '请填写有效的日期和上班时间' }

    if (new Date(clockInAt).getTime() > now) {
      return { error: '上班时间不能晚于当前时间' }
    }

    if (stillWorking) {
      const openCheckin = checkins.find(
        (item) => !item.clockOutAt && item.id !== checkin?.id,
      )
      if (openCheckin) return { error: '已经有一段进行中的打卡，请先下班打卡' }
      return { value: { clockInAt, clockOutAt: null } }
    }

    let clockOutAt = combineDateAndTime(date, clockOutTime)
    if (!clockOutAt) return { error: '请填写有效的下班时间' }

    // 下班时间早于上班时间，按跨夜处理，顺延到第二天
    if (new Date(clockOutAt).getTime() <= new Date(clockInAt).getTime()) {
      clockOutAt = shiftIsoByDays(clockOutAt, 1)
    }

    if (new Date(clockOutAt).getTime() > now) {
      return { error: '下班时间不能晚于当前时间' }
    }

    return { value: { clockInAt, clockOutAt } }
  }

  const preview = buildValue(openedAt)
  const previewSeconds = preview.value
    ? Math.round(
        ((preview.value.clockOutAt
          ? new Date(preview.value.clockOutAt).getTime()
          : openedAt) -
          new Date(preview.value.clockInAt).getTime()) /
          1000,
      )
    : 0
  const crossesMidnight = Boolean(
    preview.value?.clockOutAt &&
      toDateKey(new Date(preview.value.clockOutAt)) !== toDateKey(new Date(preview.value.clockInAt)),
  )

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    // 提交时按真实当前时间再校验一次，表单开着很久也不会放过未来时间
    const { value, error: validationError } = buildValue(Date.now())
    if (!value) {
      setError(validationError ?? '请检查填写的时间')
      return
    }

    const overlap = findCheckinOverlap(checkins, value, checkin?.id)
    if (overlap) {
      setError(`这段时间与 ${overlap.date} 的打卡记录重叠了`)
      return
    }

    onSubmit(value)
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal-narrow" role="dialog" aria-modal="true" aria-label="补卡表单">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{checkin ? '修改打卡' : '补卡'}</p>
            <h2>{checkin ? '订正打卡时间' : '补一条打卡记录'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>日期</span>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>

          <div className="form-row">
            <label className="field">
              <span>上班时间</span>
              <input
                type="time"
                value={clockInTime}
                onChange={(event) => setClockInTime(event.target.value)}
              />
            </label>

            <label className="field">
              <span>下班时间</span>
              <input
                type="time"
                value={clockOutTime}
                disabled={stillWorking}
                onChange={(event) => setClockOutTime(event.target.value)}
              />
            </label>
          </div>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={stillWorking}
              onChange={(event) => setStillWorking(event.target.checked)}
            />
            <span>还没有下班，保持这段打卡进行中</span>
          </label>

          <p className="muted checkin-preview">
            {preview.value
              ? `共 ${formatDuration(previewSeconds)}${
                  preview.value.clockOutAt ? '' : ' · 进行中'
                }${crossesMidnight ? ' · 跨夜到第二天' : ''}`
              : preview.error}
          </p>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="button primary">
              {checkin ? '保存修改' : '确认补卡'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
