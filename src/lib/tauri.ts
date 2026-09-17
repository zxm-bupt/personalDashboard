import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { ResourceKind } from '../types'

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

export async function getPlatform(): Promise<string> {
  if (!isTauri()) return 'web'
  return invoke<string>('get_os')
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await invoke('open_external', { url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function pickResource(kind: ResourceKind): Promise<string | null> {
  if (!isTauri() || kind === 'url') return null

  const platform = await getPlatform()
  const selected = await open({
    multiple: false,
    directory: kind === 'app' && platform === 'macos',
    title: kind === 'app' ? '选择应用' : '选择文件',
  })

  if (Array.isArray(selected)) return selected[0] ?? null
  return selected ?? null
}
