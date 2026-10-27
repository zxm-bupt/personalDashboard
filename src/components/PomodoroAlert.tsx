import { useEffect } from 'react'

interface PomodoroAlertProps {
  title: string
  body: string
  actionLabel: string
  /** 直接开始下一阶段；番茄钟此时已经切换到下一阶段并重置好时长。 */
  onStartNext: () => void
  onDismiss: () => void
}

export function PomodoroAlert({
  title,
  body,
  actionLabel,
  onStartNext,
  onDismiss,
}: PomodoroAlertProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onDismiss])

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal modal-narrow pomodoro-alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pomodoro-alert-title"
        aria-describedby="pomodoro-alert-body"
      >
        <svg
          className="pomodoro-alert-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        <h2 id="pomodoro-alert-title">{title}</h2>
        <p id="pomodoro-alert-body" className="muted">
          {body}
        </p>
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onDismiss}>
            稍后再说
          </button>
          <button type="button" className="button primary" onClick={onStartNext} autoFocus>
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
