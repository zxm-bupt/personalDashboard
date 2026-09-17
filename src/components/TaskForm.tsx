import { useState } from 'react'
import type { Priority, Task, TaskInput } from '../types'
import { fromDateTimeLocalValue, normalizeUrl, toDateTimeLocalValue } from '../utils'

interface TaskFormProps {
  open: boolean
  task: Task | null
  onClose: () => void
  onSubmit: (input: TaskInput) => void
}

interface ResourceDraft {
  id?: string
  title: string
  url: string
}

const emptyResource = (): ResourceDraft => ({
  title: '',
  url: '',
})

export function TaskForm({ open, task, onClose, onSubmit }: TaskFormProps) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [dueAt, setDueAt] = useState(toDateTimeLocalValue(task?.dueAt ?? null))
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'medium')
  const [resources, setResources] = useState<ResourceDraft[]>(() =>
    task && task.resources.length > 0
      ? task.resources.map((resource) => ({
          id: resource.id,
          title: resource.title,
          url: resource.url,
        }))
      : [emptyResource()],
  )
  const [error, setError] = useState('')

  if (!open) return null

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!title.trim()) {
      setError('请填写任务标题')
      return
    }

    const cleanedResources = resources
      .map((resource) => ({
        ...resource,
        title: resource.title.trim(),
        url: normalizeUrl(resource.url),
      }))
      .filter((resource) => resource.title || resource.url)

    const invalidResource = cleanedResources.find(
      (resource) => !resource.title || !resource.url,
    )
    if (invalidResource) {
      setError('网页资源需要同时填写名称和 URL')
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
                <span>网页资源</span>
                <small>Web 版仅支持 URL，后续桌面版可扩展文件和软件</small>
              </div>
              <button
                type="button"
                className="button ghost small"
                onClick={() => setResources((current) => [...current, emptyResource()])}
              >
                + 添加链接
              </button>
            </div>

            <div className="resource-rows">
              {resources.map((resource, index) => (
                <div className="resource-row" key={resource.id ?? index}>
                  <input
                    value={resource.title}
                    onChange={(event) =>
                      setResources((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, title: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="链接名称"
                  />
                  <input
                    value={resource.url}
                    onChange={(event) =>
                      setResources((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, url: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="https://..."
                  />
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
