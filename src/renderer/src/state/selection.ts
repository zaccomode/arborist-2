import { create } from 'zustand'

interface SelectionState {
  projectId: string | null
  /** Remembered per project, so switching away and back lands where you left. */
  worktreeByProject: Record<string, string>
  /** Mutually exclusive with the worktree selection: only one detail pane shows at a time. */
  remoteBranchByProject: Record<string, string>
  selectProject: (projectId: string | null) => void
  selectWorktree: (worktreePath: string | null) => void
  selectRemoteBranch: (name: string | null) => void
}

export const useSelection = create<SelectionState>((set) => ({
  projectId: null,
  worktreeByProject: {},
  remoteBranchByProject: {},
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
