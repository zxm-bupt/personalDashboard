import { useState } from 'react'
import { isTauri, pickResource } from '../lib/tauri'
import type { Priority, ResourceKind, Task, TaskInput } from '../types'
import { fromDateTimeLocalValue, normalizeUrl, toDateTimeLocalValue } from '../utils'

interface TaskFormProps {
  open: boolean
  task: Task | null
  onClose: () => void
  onSubmit: (input: TaskInput) => void
}

interface ResourceDraft {
  id?: string
  kind: ResourceKind
  title: string
  target: string
}

const emptyResource = (): ResourceDraft => ({
  kind: 'url',
  title: '',
  target: '',
})

function resourcePlaceholder(kind: ResourceKind): string {
  if (kind === 'url') return 'https://...'
  if (kind === 'file') return '/Users/you/Documents/file.pdf'
  return '/Applications/SomeApp.app'
}

function resourceKindLabel(kind: ResourceKind): string {
  if (kind === 'url') return '网页'
  if (kind === 'file') return '文件'
  return '应用'
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

export function TaskForm({ open, task, onClose, onSubmit }: TaskFormProps) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [dueAt, setDueAt] = useState(toDateTimeLocalValue(task?.dueAt ?? null))
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'medium')
  const [resources, setResources] = useState<ResourceDraft[]>(() =>
    task && task.resources.length > 0
      ? task.resources.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          title: resource.title,
          target: resource.target,
        }))
      : [emptyResource()],
  )
  const [error, setError] = useState('')
  const desktopAvailable = isTauri()

  if (!open) return null

  const handlePickResource = async (index: number) => {
    const resource = resources[index]
    const selected = await pickResource(resource.kind)
    if (!selected) return

    setResources((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              target: selected,
              title: item.title.trim() || fileNameFromPath(selected),
            }
          : item,
      ),
    )
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!title.trim()) {
      setError('请填写任务标题')
      return
    }

    const cleanedResources = resources
      .map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        title: resource.title.trim(),
        target:
          resource.kind === 'url'
            ? normalizeUrl(resource.target)
            : resource.target.trim(),
      }))
      .filter((resource) => resource.title || resource.target)

    const invalidResource = cleanedResources.find(
      (resource) => !resource.title || !resource.target,
    )
    if (invalidResource) {
      setError('每个资源都需要填写名称和地址/路径')
      return
    }

    onSubmit({
      title: title.trim(),
      description: description.trim(),
      dueAt: fromDateTimeLocalValue(dueAt),
      priority,
      resources: cleanedResources,
    })
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="任务表单">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{task ? '编辑任务' : '新建任务'}</p>
            <h2>{task ? task.title : '添加一个任务'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>任务标题 *</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：整理下周项目计划"
              autoFocus
            />
          </label>

          <label className="field">
            <span>任务描述</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="补充背景、验收标准、下一步行动..."
              rows={4}
            />
          </label>

          <div className="form-row">
            <label className="field">
              <span>DDL</span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </label>

            <label className="field">
              <span>重要程度</span>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as Priority)}
              >
                <option value="urgent">紧急</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
          </div>

          <div className="resource-editor">
            <div className="section-heading">
              <div>
                <span>任务资源</span>
                <small>
                  {desktopAvailable
                    ? '支持网页、本地文件和本地应用'
                    : 'Web 版仅支持网页 URL，桌面版支持本地文件和本地应用'}
                </small>
              </div>
              <button
                type="button"
                className="button ghost small"
                onClick={() => setResources((current) => [...current, emptyResource()])}
              >
                + 添加资源
              </button>
            </div>

            <div className="resource-rows">
              {resources.map((resource, index) => (
                <div className="resource-row" key={resource.id ?? index}>
                  <select
                    className="resource-kind"
                    value={resource.kind}
                    onChange={(event) =>
                      setResources((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                kind: event.target.value as ResourceKind,
                                target: '',
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="url">{resourceKindLabel('url')}</option>
                    {desktopAvailable && <option value="file">{resourceKindLabel('file')}</option>}
                    {desktopAvailable && <option value="app">{resourceKindLabel('app')}</option>}
                  </select>

                  <input
                    value={resource.title}
                    onChange={(event) =>
                      setResources((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, title: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="资源名称"
                  />

                  <input
                    value={resource.target}
                    onChange={(event) =>
                      setResources((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, target: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder={resourcePlaceholder(resource.kind)}
                  />

                  <div className="resource-picker-slot">
                    {resource.kind !== 'url' && desktopAvailable && (
                      <button
                        type="button"
                        className="button ghost small resource-picker"
                        onClick={() => void handlePickResource(index)}
                      >
                        选择
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="icon-button"
                    aria-label="删除资源"
                    onClick={() =>
                      setResources((current) =>
                        current.length === 1
                          ? [emptyResource()]
                          : current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="button primary">
              {task ? '保存修改' : '创建任务'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
