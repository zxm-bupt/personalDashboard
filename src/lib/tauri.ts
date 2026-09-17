import { invoke } from '@tauri-apps/api/core'

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await invoke('open_external', { url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}
