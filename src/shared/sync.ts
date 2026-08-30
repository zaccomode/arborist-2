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

/**
 * The pull button's label: the count when there is something to pull, and a
 * bare "Pull" when there is not — a button reading "Pull 0 commits" is a
 * button telling you not to press it, and the remote may have moved since
 * the last fetch regardless, which is exactly when someone presses this.
 */
export function pullLabel(behind: number): string {
  return behind > 0 ? `Pull ${behind}` : 'Pull'
}

/**
 * Which of the two sync actions a worktree can offer, and in what state.
 *
 * A worktree whose folder is gone has nothing to sync, and a detached HEAD
 * has no branch for either action to name — both drop the pair entirely
 * rather than showing two permanently disabled buttons.
 *
 * `canPull` needs an upstream that still exists: an upstream deleted on the
 * remote (`gone`) has nothing left to pull from, and pulling would fail with
 * a message about a ref that is no longer there.
 *
 * `pushEnabled` is deliberately looser than `canPull`. A branch with no
 * upstream is 0 ahead by definition, which is not the same fact as having
 * nothing to publish — see `pushLabel` in `working-tree.ts`, which says the
 * same thing about its own label.
 */
export function syncAvailability(worktree: Worktree): {
  visible: boolean
  canPull: boolean
  pushEnabled: boolean
  behind: number
  ahead: number
  hasUpstream: boolean
} {
  const status = worktree.status
  const hasUpstream = (status?.upstream ?? null) !== null
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  return {
    visible: !worktree.prunable && worktree.branch !== null && status !== null,
    canPull: hasUpstream && !(status?.gone ?? false),
    pushEnabled: !hasUpstream || ahead > 0,
    behind,
    ahead,
    hasUpstream
  }
}
