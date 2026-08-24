import type { ChangedFile } from './domain'

/**
 * The Working Tree tab's checkbox state for one file, per the model settled
 * in v3 Phase 3: checked means "will be in the next commit". A file with
 * both staged and unstaged content (`MM`) is indeterminate, and an unmerged
 * file is neither cleanly staged nor unstaged, so it reads the same way.
 */
export type StagingState = 'checked' | 'unchecked' | 'indeterminate'

export function stagingState(file: ChangedFile): StagingState {
  if (file.kind === 'unmerged') return 'indeterminate'
  const staged = file.index !== '.'
  const unstaged = file.worktree !== '.'
  if (staged && unstaged) return 'indeterminate'
  if (staged) return 'checked'
  return 'unchecked'
}

/**
 * The two-character status badge, in git's own `XY` convention (a space for
 * "unchanged on this side"), so it reads the same as `git status --short`
 * for anyone who already knows that alphabet.
 */
export function statusLabel(file: ChangedFile): string {
  if (file.kind === 'untracked') return '??'
  if (file.kind === 'ignored') return '!!'
  if (file.kind === 'unmerged') return file.conflict ?? 'UU'
  const index = file.index === '.' ? ' ' : file.index
  const worktree = file.worktree === '.' ? ' ' : file.worktree
  return `${index}${worktree}`
}

/**
 * Splits a repo-relative path into its file name and containing directory,
 * for a row that shows the name prominently and the directory dimmed
 * alongside it. `path` is always POSIX (see `ChangedFile`), so this never
 * needs `src/shared`'s forbidden `path` module.
 */
export function splitDisplayPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')
  if (slash === -1) return { name: path, dir: '' }
  return { name: path.slice(slash + 1), dir: path.slice(0, slash) }
}
