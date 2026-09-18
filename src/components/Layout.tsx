import type { ReactNode } from 'react'
import type { AppSection } from '../types'
import { formatFullDate } from '../utils'

interface LayoutProps {
  section: AppSection
  onSectionChange: (section: AppSection) => void
  onExport: () => void
  onClear: () => void
  children: ReactNode
}

const navItems: Array<{ id: AppSection; label: string; icon: string }> = [
  { id: 'dashboard', label: '仪表盘', icon: '⌂' },
  { id: 'tasks', label: '任务', icon: '✓' },
  { id: 'time', label: '时间记录', icon: '◷' },
]

const sectionTitles: Record<AppSection, { title: string; subtitle: string }> = {
  dashboard: { title: '仪表盘', subtitle: '今天要做什么，一眼看清' },
  tasks: { title: '任务', subtitle: '任务、DDL、优先级和关联资源' },
  time: { title: '时间记录', subtitle: '打卡和专注计时' },
}

export function Layout({
  section,
  onSectionChange,
  onExport,
  onClear,
  children,
}: LayoutProps) {
  const heading = sectionTitles[section]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">🐶</span>
          <div>
            <strong>Workbench</strong>
            <span>个人工作台</span>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === section ? 'nav-item active' : 'nav-item'}
              onClick={() => onSectionChange(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{formatFullDate(new Date())}</p>
            <h1>{heading.title}</h1>
            <p className="subtitle">{heading.subtitle}</p>
          </div>

          <div className="topbar-actions">
            <button type="button" className="button ghost" onClick={onExport}>
              导出数据
            </button>
            <button
              type="button"
              className="button ghost danger-text"
              onClick={() => {
                if (window.confirm('确定清空全部本地数据吗？此操作不可恢复。')) {
                  onClear()
                }
              }}
            >
              清空
            </button>
          </div>
        </header>

        <div className="content">{children}</div>
      </main>
    </div>
  )
}
