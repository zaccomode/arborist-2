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

/** The status badge's colour category, keyed by callers into actual classes. */
export type StatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'conflict' | 'muted'

/**
 * Which colour category a status badge falls into, by the change it's most
 * useful to notice first when a file has more than one (`AM` reads as
 * "added", not "modified" — the file being brand new is the more surprising
 * fact). Order: added, deleted, renamed/copied, type-changed, modified.
 *
 * Returns a category rather than a Tailwind class string: Tailwind's
 * content scanner only covers the renderer root, not `src/shared`, so a
 * class name returned from here never makes it into the compiled CSS.
 */
export function statusKind(file: ChangedFile): StatusKind {
  if (file.kind === 'untracked') return 'added'
  if (file.kind === 'ignored') return 'muted'
  if (file.kind === 'unmerged') return 'conflict'

  const codes = [file.index, file.worktree]
  if (codes.includes('A')) return 'added'
  if (codes.includes('D')) return 'deleted'
  if (codes.includes('R') || codes.includes('C')) return 'renamed'
  if (codes.includes('T') || codes.includes('M')) return 'modified'
  return 'muted'
}

/**
 * Whether a row in the Working Tree tab can open the diff panel. An
 * unmerged file has no ordinary diff to show — `git diff` gives a combined
 * `--cc` diff for it, which #53's conflict card replaces rather than this
 * panel rendering.
 */
export function isInspectable(file: ChangedFile): boolean {
  return file.kind !== 'unmerged'
}

/**
 * Which side of the file a click on its row opens: whichever side actually
 * has content, preferring staged when a file has both (`MM`) since that's
 * what the next commit will contain.
 */
export function diffSideFor(file: ChangedFile): 'staged' | 'unstaged' | 'untracked' {
  if (file.kind === 'untracked') return 'untracked'
  return file.index !== '.' ? 'staged' : 'unstaged'
}

/** The paths to pass `git add`/`git restore --staged`: both sides of a rename, or just the path. */
export function stagePathsFor(file: ChangedFile): string[] {
  return file.origPath && file.origPath !== file.path ? [file.origPath, file.path] : [file.path]
}

/**
 * Files with staged content, read from the index (`index !== '.'`) rather
 * than from checked rows — a hunk-staged file (#49) contributes one file to
 * this count, not the whole row, and an unmerged file contributes none: git
 * would refuse to commit it unresolved regardless of what's checked.
 */
export function stagedFileCount(files: ChangedFile[]): number {
  return files.filter((file) => file.kind !== 'unmerged' && file.index !== '.').length
}

/**
 * The push button's label: "Push N commits" once there's an upstream to
 * compare against, or an offer to publish the branch when there isn't one
 * yet — `ahead` is always 0 with no upstream, which isn't the same as
 * nothing to push.
 */
export function pushLabel(ahead: number, hasUpstream: boolean): string {
  if (!hasUpstream) return 'Publish branch'
  return `Push ${ahead} commit${ahead === 1 ? '' : 's'}`
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
