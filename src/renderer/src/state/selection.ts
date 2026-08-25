import { create } from 'zustand'
import type { WorktreeTab } from '@shared/domain'
import type { SelectionState as PersistedSelection } from '@shared/persisted'
import { worktreeNoteKey } from '@shared/persisted'
import { invoke } from '@/api/client'

/** The third panel's content. Mutually exclusive with a tab switch leaving it alone. */
export type Inspector =
  | { kind: 'file'; path: string; side: 'unstaged' | 'staged' | 'untracked' }
  | { kind: 'commit'; hash: string }

interface SelectionState {
  projectId: string | null
  /** Remembered per project, so switching away and back lands where you left. */
  worktreeByProject: Record<string, string>
  /** Mutually exclusive with the worktree selection: only one detail pane shows at a time. */
  remoteBranchByProject: Record<string, string>
  /**
   * The worktree detail pane's active tab, keyed like `worktreeNoteKey` —
   * session-only, so flipping between two worktrees feels right without a
   * persistence round-trip for something this disposable.
   */
  tabByWorktree: Record<string, WorktreeTab>
  /**
   * The third panel's content, keyed the same way — also session-only.
   * Absent means closed; there's no default worth remembering the way
   * Overview is for the tab.
   */
  inspectorByWorktree: Record<string, Inspector>
  /** Set once the persisted selection has been read back, so a fresh session's nulls don't overwrite it. */
  hydrated: boolean
  hydrate: (data: PersistedSelection) => void
  selectProject: (projectId: string | null) => void
  selectWorktree: (worktreePath: string | null) => void
  selectRemoteBranch: (name: string | null) => void
  selectTab: (repositoryId: string, worktreePath: string, tab: WorktreeTab) => void
  /** Opening an inspector also sets the tab it belongs on; switching tabs leaves it alone. */
  openInspector: (repositoryId: string, worktreePath: string, inspector: Inspector) => void
  closeInspector: (repositoryId: string, worktreePath: string) => void
}

export const useSelection = create<SelectionState>((set) => ({
  projectId: null,
  worktreeByProject: {},
  remoteBranchByProject: {},
  tabByWorktree: {},
  inspectorByWorktree: {},
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
    }),
  selectTab: (repositoryId, worktreePath, tab) =>
    set((state) => ({
      tabByWorktree: { ...state.tabByWorktree, [worktreeNoteKey(repositoryId, worktreePath)]: tab }
    })),
  openInspector: (repositoryId, worktreePath, inspector) =>
    set((state) => {
      const key = worktreeNoteKey(repositoryId, worktreePath)
      const tab: WorktreeTab = inspector.kind === 'file' ? 'working-tree' : 'commit-graph'
      return {
        inspectorByWorktree: { ...state.inspectorByWorktree, [key]: inspector },
        tabByWorktree: { ...state.tabByWorktree, [key]: tab }
      }
    }),
  closeInspector: (repositoryId, worktreePath) =>
    set((state) => {
      const key = worktreeNoteKey(repositoryId, worktreePath)
      if (!(key in state.inspectorByWorktree)) return state
      const inspectorByWorktree = { ...state.inspectorByWorktree }
      delete inspectorByWorktree[key]
      return { inspectorByWorktree }
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

/** A worktree's remembered tab, defaulting to Overview, plus its setter. */
export function useWorktreeTab(
  repositoryId: string,
  worktreePath: string
): [WorktreeTab, (tab: WorktreeTab) => void] {
  const key = worktreeNoteKey(repositoryId, worktreePath)
  const tab = useSelection((state) => state.tabByWorktree[key] ?? 'overview')
  const selectTab = useSelection((state) => state.selectTab)
  return [tab, (next) => selectTab(repositoryId, worktreePath, next)]
}

/** A worktree's open inspector, if any, plus its open/close actions. */
export function useWorktreeInspector(
  repositoryId: string,
  worktreePath: string
): [Inspector | null, (inspector: Inspector) => void, () => void] {
  const key = worktreeNoteKey(repositoryId, worktreePath)
  const inspector = useSelection((state) => state.inspectorByWorktree[key] ?? null)
  const open = useSelection((state) => state.openInspector)
  const close = useSelection((state) => state.closeInspector)
  return [
    inspector,
    (next) => open(repositoryId, worktreePath, next),
    () => close(repositoryId, worktreePath)
  ]
}
