import { invoke } from '@tauri-apps/api/core'
import { loadState, saveState } from '../storage'
import type { WorkbenchState } from '../types'
import { isTauri } from '../lib/tauri'

export async function loadWorkbench(): Promise<WorkbenchState> {
  if (isTauri()) {
    return invoke<WorkbenchState>('load_workbench')
  }

  return loadState()
}

export async function saveWorkbench(state: WorkbenchState): Promise<void> {
  if (isTauri()) {
    await invoke('save_workbench', { payload: state })
    return
  }

  saveState(state)
}
