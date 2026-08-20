import { create } from 'zustand'

interface SelectionState {
  projectId: string | null
  /** Remembered per project, so switching away and back lands where you left. */
  worktreeByProject: Record<string, string>
  selectProject: (projectId: string | null) => void
  selectWorktree: (worktreePath: string | null) => void
}

export const useSelection = create<SelectionState>((set) => ({
  projectId: null,
  worktreeByProject: {},
  selectProject: (projectId) => set({ projectId }),
  selectWorktree: (worktreePath) =>
    set((state) => {
      if (!state.projectId) return state
      const worktreeByProject = { ...state.worktreeByProject }
      if (worktreePath) worktreeByProject[state.projectId] = worktreePath
      else delete worktreeByProject[state.projectId]
      return { worktreeByProject }
    })
}))

export function useSelectedWorktree(): string | null {
  return useSelection((state) =>
    state.projectId ? (state.worktreeByProject[state.projectId] ?? null) : null
  )
}
