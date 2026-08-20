/**
 * Domain types shared by main and renderer. Pure type declarations: no
 * behaviour, no imports, nothing platform-specific.
 */

export type GitSource = 'settings' | 'path' | 'known-location' | 'none'

export interface GitDiscoveryResult {
  found: boolean
  path: string | null
  version: string | null
  source: GitSource
  /** Set when a settings override was supplied but did not run. */
  overrideError: string | null
}

/**
 * How the persistence layer came up. Both fields are things the user needs
 * telling about: v1 swallowed them, and people lost notes without knowing.
 */
export interface StoreStatus {
  /** The data file was unreadable, was backed up, and the app started fresh. */
  corruptWarning: string | null
  /** The data file came from a newer version, so nothing will be saved. */
  readOnlyReason: string | null
}

/** One stanza of `git worktree list --porcelain`. */
export interface WorktreeEntry {
  path: string
  /** Commit the worktree is checked out at; absent for a bare repository. */
  head: string | null
  /** Short branch name, or null when HEAD is detached. */
  branch: string | null
  /**
   * The repository's own worktree, which git always lists first. It cannot
   * be removed, so the UI protects it.
   */
  isMain: boolean
  isBare: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
  prunableReason: string | null
}

export interface BranchInfo {
  name: string
  current: boolean
}

export interface AheadBehind {
  ahead: number
  behind: number
}

export interface WorkingTreeStatus {
  dirty: boolean
  staged: number
  unstaged: number
  untracked: number
}
