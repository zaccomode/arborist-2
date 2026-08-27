/**
 * Merge/rebase/cherry-pick/revert conflicts: how a `u` record's two-letter
 * code reads to a human, what to call the operation in progress, and the
 * banner text the Conflicts section shows. Pure — the detection that fills in
 * a `ConflictState` lives in `src/main/services/git/conflict-state.ts`, which
 * this file knows nothing about; everything here just formats what it's given.
 */
import type { UnmergedCode } from './domain'

/**
 * Which git operation left the worktree conflicted. `null` means none is in
 * progress — the ordinary "no conflicts" state, not a fourth kind of
 * conflict.
 */
export type ConflictOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

/**
 * Everything the Conflicts banner needs. `sourceLabel`/`targetLabel` are
 * null whenever the detection in `conflict-state.ts` couldn't resolve a
 * human name (an unparsuable `MERGE_MSG`, a rebase mid-flight with no
 * `head-name` file yet) — `conflictBannerText` degrades to a shorter
 * sentence rather than showing a blank.
 */
export interface ConflictState {
  operation: ConflictOperation | null
  /** The branch/commit being brought in — a branch name or a short hash. */
  sourceLabel: string | null
  /** The branch conflicts are landing on. */
  targetLabel: string | null
}

/** The two-letter `u`-record code, in words — shown instead of a generic "conflict". */
export function conflictCodeLabel(code: UnmergedCode): string {
  switch (code) {
    case 'UU':
      return 'both modified'
    case 'AA':
      return 'both added'
    case 'DD':
      return 'both deleted'
    case 'AU':
      return 'added by us'
    case 'UA':
      return 'added by them'
    case 'DU':
      return 'deleted by us'
    case 'UD':
      return 'deleted by them'
  }
}

/**
 * Whether "Keep ours (discard theirs)" — `git checkout --ours`, one call —
 * makes sense for this code. Only `UU`: on `AA` it silently drops a file
 * either side thought it was adding, and on `DU`/`UD` "ours" or "theirs" is
 * a deletion, which `checkout --ours` cannot express at all.
 */
export function canKeepOurs(code: UnmergedCode | null): boolean {
  return code === 'UU'
}

/** The present participle for a conflict banner: "Merging", "Rebasing", … */
export function conflictVerb(operation: ConflictOperation): string {
  switch (operation) {
    case 'merge':
      return 'Merging'
    case 'rebase':
      return 'Rebasing'
    case 'cherry-pick':
      return 'Cherry-picking'
    case 'revert':
      return 'Reverting'
  }
}

function pluralFiles(count: number): string {
  return `${count} file${count === 1 ? '' : 's'} conflict.`
}

/**
 * The Conflicts section's banner, e.g. "Merging origin/main into feature-x —
 * 2 files conflict." Falls back to a shorter sentence whenever a label is
 * missing rather than rendering "into null" — a rebase caught before its
 * `head-name` file exists, or a `MERGE_MSG` in a shape `parseMergeSourceFromMsg`
 * doesn't recognise, both leave labels null.
 */
export function conflictBannerText(state: ConflictState, conflictCount: number): string {
  const files = pluralFiles(conflictCount)
  if (!state.operation) return files

  const verb = conflictVerb(state.operation)
  switch (state.operation) {
    case 'merge':
      if (state.sourceLabel && state.targetLabel) {
        return `${verb} ${state.sourceLabel} into ${state.targetLabel} — ${files}`
      }
      break
    case 'rebase':
      if (state.sourceLabel && state.targetLabel) {
        return `${verb} ${state.targetLabel} onto ${state.sourceLabel} — ${files}`
      }
      break
    case 'cherry-pick':
    case 'revert':
      if (state.sourceLabel) return `${verb} ${state.sourceLabel} — ${files}`
      break
  }
  return `${verb} — ${files}`
}

/**
 * `git <operation> --abort`. The operation names line up exactly with git's
 * own subcommands, so there's no separate mapping table to keep in sync.
 */
export function abortArgsFor(operation: ConflictOperation): string[] {
  return [operation, '--abort']
}

/**
 * `git <operation> --continue`, with `-c core.editor=true`: a merge or
 * rebase continuing opens the commit-message editor by default, and
 * `GIT_TERMINAL_PROMPT=0` (set app-wide) does nothing about that — the child
 * just hangs until `DEFAULT_TIMEOUT_MS`. `core.editor=true` makes it a no-op
 * editor that exits immediately and keeps whatever message git prepared.
 */
export function continueArgsFor(operation: ConflictOperation): string[] {
  return ['-c', 'core.editor=true', operation, '--continue']
}

/** `refs/heads/feature-x` -> `feature-x`, the form a rebase's `head-name` file stores. */
export function shortRefName(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
}

/**
 * The human name of what's being merged, from `MERGE_MSG`'s first line —
 * `Merge branch 'main' into feature-x` -> `main`, `Merge remote-tracking
 * branch 'origin/main' into feature-x` -> `origin/main`. Null when the
 * message doesn't match a shape git itself produces (a custom merge message,
 * or a squash merge with no such line) — the caller falls back to a short
 * hash of `MERGE_HEAD` in that case, which this function has no way to
 * compute since it never sees git.
 */
export function parseMergeSourceFromMsg(message: string): string | null {
  const firstLine = message.split(/\r?\n/, 1)[0] ?? ''
  const patterns = [
    /^Merge remote-tracking branch '([^']+)'/,
    /^Merge branch '([^']+)'/,
    /^Merge tag '([^']+)'/,
    /^Merge commit '([^']+)'/
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(firstLine)
    if (match) return match[1]
  }
  return null
}
