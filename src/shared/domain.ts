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

export interface CommitSummary {
  hash: string
  shortHash: string
  author: string
  /** ISO 8601, so the renderer can format it in the user's locale. */
  date: string
  subject: string
}

/**
 * A commit as the Recent Commits panel shows it: `CommitSummary` plus the
 * `--shortstat` line. Kept separate from `CommitSummary` because the
 * single-commit format the refresh pipeline uses (`%H%x00%h%x00...`) has no
 * shortstat, and giving every caller three more fields it never asked for
 * would be its own kind of noise.
 */
export interface CommitLogEntry extends CommitSummary {
  filesChanged: number
  insertions: number
  deletions: number
}

/** What a branch's upstream is doing, as git's `%(upstream:track)` reports it. */
export interface UpstreamTrack {
  ahead: number
  behind: number
  /** The upstream is still configured, but the remote branch is gone. */
  gone: boolean
}

export interface WorktreeStatus extends WorkingTreeStatus, UpstreamTrack {
  /** Short upstream name (`origin/main`), or null when nothing is tracked. */
  upstream: string | null
  lastCommit: CommitSummary | null
}

/**
 * A worktree as the sidebar shows it: what git listed, plus whatever
 * enrichment managed to run. `status` is null when enrichment failed, which
 * is a state the UI shows rather than one that fails the refresh.
 */
export interface Worktree extends WorktreeEntry {
  status: WorktreeStatus | null
  statusError: string | null
}

/**
 * A remote branch with no local worktree of its own — the Remote Branches
 * sidebar section only ever lists these, so there is nothing here to say a
 * worktree already exists.
 */
export interface RemoteBranch {
  /** Full remote-tracking ref, e.g. `origin/feature-x`. */
  name: string
  /** `name` with its remote prefix stripped, e.g. `feature-x`. */
  shortName: string
  lastCommit: CommitSummary | null
}
