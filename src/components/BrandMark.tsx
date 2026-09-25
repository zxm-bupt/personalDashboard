/**
 * 品牌标记：表盘里的对勾，对应工作台的任务 + 时间两条主线。
 * 用线性图标而不是 emoji，才能继承侧边栏的白色描边和几何风格。
 */
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M7.8 12.4 L10.7 15.3 L16.3 9.1" />
    </svg>
  )
}
