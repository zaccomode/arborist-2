import type { Worktree } from './domain'

/**
 * How a pull integrates what it fetched (#78).
 *
 * `ff-only` is the default because it is the only one of the three that
 * cannot surprise anyone: it either moves the branch pointer forward or it
 * refuses, so it never writes a merge commit nobody asked for and never
 * leaves a conflict behind. The other two exist for the case it refuses —
 * a branch that has diverged — where the alternative to offering them is
 * telling the user to go and use a terminal.
 */
export type PullMode = 'ff-only' | 'rebase' | 'merge'

/** What a pull did, beyond succeeding — see `GitService.pull`. */
export interface PullResult {
  /** The pull left `u` records behind, for the Conflicts section to pick up. */
  conflict: boolean
  /**
   * `ff-only` refused because the branch and its upstream have both moved.
   * Not an error: it is the answer to "can this be fast-forwarded", and the
   * caller turns it into the offer of a rebase or a merge.
   */
  diverged: boolean
}

/** What each mode is called where the user picks one. */
export const PULL_MODE_LABELS: Record<PullMode, string> = {
  'ff-only': 'Pull',
  rebase: 'Pull and rebase',
  merge: 'Pull and merge'
}

/**
 * The argv for a pull, before `-C <worktree>`.
 *
 * `-c core.editor=true` for the same reason `continueArgsFor` carries it: a
 * merge or rebase that needs a commit message opens `core.editor`, and
 * `GIT_TERMINAL_PROMPT=0` does nothing about an editor — the child simply
 * hangs until the timeout with nothing to say it is waiting. A no-op editor
 * exits immediately and keeps whatever message git prepared.
 *
 * `--no-edit` alongside it on the merge path is not redundant so much as
 * belt-and-braces: it is the flag that says "do not open one" rather than
 * the config that makes opening one harmless.
 */
export function pullArgsFor(mode: PullMode): string[] {
  const base = ['-c', 'core.editor=true', 'pull']
  switch (mode) {
    case 'ff-only':
      return [...base, '--ff-only']
    case 'rebase':
      return [...base, '--rebase']
    case 'merge':
      return [...base, '--no-rebase', '--no-edit']
  }
}

/** The pull button's label. Only ever rendered with something to pull — see `syncAvailability`. */
export function pullLabel(behind: number): string {
  return `Pull ${behind}`
}

/**
 * Which of the two sync actions a worktree can offer.
 *
 * Each button exists only when it has work to do (#79 review): Pull when the
 * branch is actually behind, Push when there is something local to send.
 * Between them they are absent more often than present, which is the point —
 * a header that only grows a control when that control would change
 * something is a header you can read at a glance, where a permanently
 * disabled pair is furniture.
 *
 * The consequence worth knowing: with nothing behind, there is no Pull button
 * to press *speculatively*. `behind` only moves after a fetch, so the flow is
 * Fetch (the Remote Branches header) and then Pull, rather than pulling to
 * find out. That is the same order git works in, and it is why the fetch
 * control is not the one being hidden here.
 *
 * `canPull` needs an upstream that still exists: one deleted on the remote
 * (`gone`) has nothing left to pull from, and the counts against it are
 * stale anyway.
 *
 * `canPush` is deliberately looser. A branch with no upstream is 0 ahead by
 * definition, which is not the same fact as having nothing to publish — see
 * `pushLabel` in `working-tree.ts`, which says the same thing about its own
 * label.
 *
 * A worktree whose folder is gone has nothing to sync, and a detached HEAD
 * has no branch for either action to name, so both are false for either.
 */
export function syncAvailability(worktree: Worktree): {
  canPull: boolean
  canPush: boolean
  behind: number
  ahead: number
  hasUpstream: boolean
} {
  const status = worktree.status
  const usable = !worktree.prunable && worktree.branch !== null && status !== null
  const hasUpstream = (status?.upstream ?? null) !== null
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  return {
    canPull: usable && hasUpstream && !(status?.gone ?? false) && behind > 0,
    canPush: usable && (!hasUpstream || ahead > 0),
    behind,
    ahead,
    hasUpstream
  }
}
