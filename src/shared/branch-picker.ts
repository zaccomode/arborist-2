/**
 * The rows the switch-branch palette shows, and how typing narrows them
 * (#96). Kept pure so ordering and matching — the part of the old picker that
 * kept burying `main` — are tested directly rather than through the UI.
 *
 * The old picker leaned on cmdk's fuzzy scorer, which ranks by character
 * proximity across the whole label: typing `main` scored `feature/domain-
 * maintenance` alongside `main` itself, and nothing put the default branch
 * first. This ranks whole-name and segment-prefix matches above loose ones,
 * and breaks every tie in favour of the default branch, then recency.
 */
import type { CommitSummary, LocalBranch, RemoteBranch, WorktreeEntry } from './domain'
import { samePath } from './paths'

/**
 * The repository's default branch, by name: whatever `origin/HEAD` points at
 * when it's set (`git clone` sets it), otherwise `main` or `master`, the
 * first one that exists locally or on a remote. Null when none of those
 * apply — there is then no branch to pin to the top, which is fine.
 */
export function resolveDefaultBranch(
  remoteHead: string | null,
  localNames: readonly string[],
  remoteShortNames: readonly string[]
): string | null {
  if (remoteHead) {
    const slash = remoteHead.indexOf('/')
    const name = slash === -1 ? '' : remoteHead.slice(slash + 1)
    if (name && name !== 'HEAD') return name
  }
  for (const candidate of ['main', 'master']) {
    if (localNames.includes(candidate) || remoteShortNames.includes(candidate)) return candidate
  }
  return null
}

export interface BranchRow {
  /** Unique across every row in the palette, and what cmdk tracks focus by. */
  key: string
  /**
   * `head` appears only in the base-ref step of the create flow, where
   * "wherever this worktree is now" is a start point like any other.
   */
  kind: 'local' | 'remote' | 'head'
  /** Shown, and what's handed on: a local name, a full remote ref, or `''` for HEAD. */
  name: string
  /** A remote ref's name without its remote prefix; the same as `name` otherwise. */
  shortName: string
  isDefault: boolean
  upstream: string | null
  lastCommit: CommitSummary | null
  /**
   * Another worktree already on this branch. Git refuses to check a branch
   * out twice, so the row is listed — it'd be confusing for an existing
   * branch to vanish — but can't be picked, and says why.
   */
  checkedOutAt: string | null
}

/** Whether a row can be picked at all. */
export function isAvailable(row: BranchRow): boolean {
  return row.checkedOutAt === null
}

function commitTime(row: BranchRow): number {
  const time = row.lastCommit ? Date.parse(row.lastCommit.date) : NaN
  return Number.isNaN(time) ? -Infinity : time
}

/**
 * Default branch first, then most recently committed to, then by name — the
 * order the palette shows with nothing typed. Recency rather than local-then-
 * remote: the branch someone is reaching for is usually the one that just
 * moved, whichever side it lives on. Unavailable rows always sink to the end.
 */
function compareRows(a: BranchRow, b: BranchRow): number {
  if (isAvailable(a) !== isAvailable(b)) return isAvailable(a) ? -1 : 1
  if (a.kind === 'head' || b.kind === 'head') return a.kind === 'head' ? -1 : 1
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  // A local default above its remote counterpart: picking the local one is
  // a plain switch, which is what anyone picking "main" means.
  if (a.isDefault && a.kind !== b.kind) return a.kind === 'local' ? -1 : 1
  const byTime = commitTime(b) - commitTime(a)
  if (byTime !== 0) return byTime
  return a.name.localeCompare(b.name)
}

/**
 * Every branch the switch palette offers for the worktree at `worktreePath`:
 * local branches other than the one it's on, and remote branches with no
 * local branch of the same name — picking one of those creates the local
 * branch that tracks it (#86). `remote` is `branches:remote`, which has
 * already dropped the remote branches a worktree is on.
 */
export function switchRows({
  local,
  remote,
  worktrees,
  worktreePath,
  defaultBranch,
  platform
}: {
  local: readonly LocalBranch[]
  remote: readonly RemoteBranch[]
  worktrees: readonly WorktreeEntry[]
  worktreePath: string
  defaultBranch: string | null
  /** Required: this runs in the renderer, which has no `process` to default from. */
  platform: NodeJS.Platform
}): BranchRow[] {
  const here = worktrees.find((entry) => samePath(entry.path, worktreePath, platform))
  const elsewhere = new Map<string, string>()
  for (const entry of worktrees) {
    if (entry.branch && !samePath(entry.path, worktreePath, platform)) {
      elsewhere.set(entry.branch, entry.path)
    }
  }
  const localNames = new Set(local.map((branch) => branch.name))

  const rows: BranchRow[] = [
    ...local
      .filter((branch) => branch.name !== here?.branch)
      .map((branch) => ({
        key: `local:${branch.name}`,
        kind: 'local' as const,
        name: branch.name,
        shortName: branch.name,
        isDefault: branch.name === defaultBranch,
        upstream: branch.upstream,
        lastCommit: branch.lastCommit,
        checkedOutAt: elsewhere.get(branch.name) ?? null
      })),
    ...remote
      .filter((branch) => !localNames.has(branch.shortName))
      .map((branch) => ({
        key: `remote:${branch.name}`,
        kind: 'remote' as const,
        name: branch.name,
        shortName: branch.shortName,
        isDefault: branch.shortName === defaultBranch,
        upstream: null,
        lastCommit: branch.lastCommit,
        checkedOutAt: null
      }))
  ]
  return rows.sort(compareRows)
}

/**
 * The start points the create flow's second step offers: HEAD first, then
 * every local and remote branch — any of them is a valid base, including the
 * ones checked out elsewhere, which is why nothing here is unavailable.
 */
export function baseRows({
  local,
  remote,
  defaultBranch,
  head
}: {
  local: readonly LocalBranch[]
  remote: readonly RemoteBranch[]
  defaultBranch: string | null
  /** The worktree's branch and tip, for the HEAD row's label and detail. */
  head: { branch: string | null; lastCommit: CommitSummary | null }
}): BranchRow[] {
  const rows: BranchRow[] = [
    {
      key: 'head',
      kind: 'head',
      name: '',
      shortName: head.branch ?? 'HEAD',
      isDefault: false,
      upstream: null,
      lastCommit: head.lastCommit,
      checkedOutAt: null
    },
    ...local.map((branch) => ({
      key: `local:${branch.name}`,
      kind: 'local' as const,
      name: branch.name,
      shortName: branch.name,
      isDefault: branch.name === defaultBranch,
      upstream: branch.upstream,
      lastCommit: branch.lastCommit,
      checkedOutAt: null
    })),
    ...remote.map((branch) => ({
      key: `remote:${branch.name}`,
      kind: 'remote' as const,
      name: branch.name,
      shortName: branch.shortName,
      isDefault: branch.shortName === defaultBranch,
      upstream: null,
      lastCommit: branch.lastCommit,
      checkedOutAt: null
    }))
  ]
  return rows.sort(compareRows)
}

/** Whether `text` has every character of `query`, in order. */
function isSubsequence(query: string, text: string): boolean {
  let at = 0
  for (const char of text) {
    if (char === query[at]) at++
    if (at === query.length) return true
  }
  return at === query.length
}

/**
 * How well `query` (already lower-cased and trimmed) matches a row, lower
 * being better, or null for no match at all:
 *
 * 0. the whole name, or a remote's short name — `main` for `origin/main`
 * 1. a prefix of the name or short name
 * 2. a prefix of any `/`, `-`, `_` or `.` separated segment — `login` for
 *    `feature/login-form`
 * 3. anywhere in the name
 * 4. every character, in order, anywhere — the loose fallback the old fuzzy
 *    scorer applied to everything
 */
export function matchScore(query: string, row: BranchRow): number | null {
  const names = [row.name, row.shortName, ...(row.kind === 'head' ? ['head'] : [])].map((name) =>
    name.toLowerCase()
  )
  if (names.some((name) => name === query)) return 0
  if (names.some((name) => name.startsWith(query))) return 1
  if (names.some((name) => name.split(/[/\-_.]/).some((segment) => segment.startsWith(query)))) {
    return 2
  }
  if (names.some((name) => name.includes(query))) return 3
  if (names.some((name) => isSubsequence(query, name))) return 4
  return null
}

/**
 * The rows matching `query`, best match first. With nothing typed, every row
 * in its resting order. Ties — and there are many, since most matches are
 * prefix or segment matches — keep that resting order, which is what keeps
 * the default branch on top whenever it matches as well as anything else.
 */
export function filterRows(rows: readonly BranchRow[], query: string): BranchRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows
    .map((row, index) => ({ row, index, score: matchScore(needle, row) }))
    .filter((entry): entry is { row: BranchRow; index: number; score: number } => {
      return entry.score !== null
    })
    .sort((a, b) => {
      if (isAvailable(a.row) !== isAvailable(b.row)) return isAvailable(a.row) ? -1 : 1
      return a.score - b.score || a.index - b.index
    })
    .map((entry) => entry.row)
}

/**
 * Whether typing `query` should offer to create it as a new branch: only when
 * it isn't already a branch by any name the palette knows it as. A remote's
 * short name counts — picking that row already creates the tracking branch,
 * so a second "create" for the same name would make a different branch of
 * it, from HEAD.
 */
export function offerCreate(
  query: string,
  localNames: readonly string[],
  remote: readonly RemoteBranch[]
): boolean {
  const name = query.trim()
  if (!name) return false
  if (localNames.includes(name)) return false
  return !remote.some((branch) => branch.name === name || branch.shortName === name)
}
