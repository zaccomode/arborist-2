import { create } from 'zustand'
import type { SelectionState as PersistedSelection } from '@shared/persisted'
import { invoke } from '@/api/client'

interface SelectionState {
  projectId: string | null
  /** Remembered per project, so switching away and back lands where you left. */
  worktreeByProject: Record<string, string>
  /** Mutually exclusive with the worktree selection: only one detail pane shows at a time. */
  remoteBranchByProject: Record<string, string>
  /** Set once the persisted selection has been read back, so a fresh session's nulls don't overwrite it. */
  hydrated: boolean
  hydrate: (data: PersistedSelection) => void
  selectProject: (projectId: string | null) => void
  selectWorktree: (worktreePath: string | null) => void
  selectRemoteBranch: (name: string | null) => void
}

export const useSelection = create<SelectionState>((set) => ({
  projectId: null,
  worktreeByProject: {},
  remoteBranchByProject: {},
  hydrated: false,
  hydrate: (data) => set({ ...data, hydrated: true }),
  selectProject: (projectId) => set({ projectId }),
  selectWorktree: (worktreePath) =>
    set((state) => {
      if (!state.projectId) return state
      const worktreeByProject = { ...state.worktreeByProject }
      const remoteBranchByProject = { ...state.remoteBranchByProject }
      if (worktreePath) {
        worktreeByProject[state.projectId] = worktreePath
        delete remoteBranchByProject[state.projectId]
      } else {
        delete worktreeByProject[state.projectId]
      }
      return { worktreeByProject, remoteBranchByProject }
    }),
  selectRemoteBranch: (name) =>
    set((state) => {
      if (!state.projectId) return state
      const remoteBranchByProject = { ...state.remoteBranchByProject }
      const worktreeByProject = { ...state.worktreeByProject }
      if (name) {
        remoteBranchByProject[state.projectId] = name
        delete worktreeByProject[state.projectId]
      } else {
        delete remoteBranchByProject[state.projectId]
      }
      return { remoteBranchByProject, worktreeByProject }
    })
}))

// Persists every change once the initial state has been read back, so a
// session that hasn't loaded it yet can't race the read and overwrite the
// saved selection with the store's starting nulls.
useSelection.subscribe((state) => {
  if (!state.hydrated) return
  void invoke('selection:update', {
    projectId: state.projectId,
    worktreeByProject: state.worktreeByProject,
    remoteBranchByProject: state.remoteBranchByProject
  })
})

export function useSelectedWorktree(): string | null {
  return useSelection((state) =>
    state.projectId ? (state.worktreeByProject[state.projectId] ?? null) : null
  )
}

export function useSelectedRemoteBranch(): string | null {
  return useSelection((state) =>
    state.projectId ? (state.remoteBranchByProject[state.projectId] ?? null) : null
  )
}
