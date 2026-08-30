import type { RemoteBranch, Worktree } from './domain'
import { worktreeTitle } from './format'

/**
 * How the sidebar's two lists are ordered (#77). One value per list type,
 * app-wide and persisted in settings, so an order chosen on one project is
 * the order every project uses — the alternative, remembering it per
 * project, means the same list arriving in a different order depending on
 * which repository you opened last.
 *
 * `'recently-updated'` reads the tip commit's date, which is the only
 * timestamp Arborist holds per worktree and per remote branch. The issue
 * asked for "recently edited"; a worktree with uncommitted changes is
 * genuinely edited and this will not notice, so the label says "updated"
 * rather than claiming something the data cannot support.
 */
export type ListSort = 'alphabetical' | 'recently-updated'

/** What each sort is called in the menu. */
export const LIST_SORT_LABELS: Record<ListSort, string> = {
  alphabetical: 'Alphabetical',
  'recently-updated': 'Recently updated'
}

/**
 * Whether a worktree is the one "keep main at the top" pins.
 *
 * The repository's own worktree is the durable half of this: git always
 * lists it first, it cannot be removed, and the sidebar already draws it
 * with its own icon. Matching a branch named `main` or `master` as well
 * covers the case the request is actually describing — a repository whose
 * default branch lives in a worktree of its own — without either reading
 * alone having to be the whole answer.
 */
export function isPinnedWorktree(worktree: Worktree): boolean {
  return worktree.isMain || worktree.branch === 'main' || worktree.branch === 'master'
}

/**
 * Newest first, with anything undated sorted last rather than treated as
 * infinitely old — a worktree whose enrichment failed has no date, and
 * burying it at the bottom is less misleading than claiming it is the
 * stalest thing in the list.
 */
function byDateDescending(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  return Date.parse(b) - Date.parse(a)
}

/**
 * `localeCompare` with numeric collation, so `release/2` sorts before
 * `release/10` rather than after it the way a plain code-point comparison
 * puts them.
 */
function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * The sidebar's worktree order. `mainFirst` pins whatever
 * `isPinnedWorktree` matches above the rest, and the chosen sort then
 * orders within each of the two groups — pinning is a partition, not a
 * separate sort, so two pinned worktrees still sort against each other the
 * way the rest of the list does.
 *
 * Ties fall back to the name under either sort, so a repository where
 * several worktrees share a commit date still has one stable order rather
 * than whatever order git happened to list them in.
 */
export function sortWorktrees(
  worktrees: readonly Worktree[],
  sort: ListSort,
  mainFirst: boolean
): Worktree[] {
  return [...worktrees].sort((a, b) => {
    if (mainFirst) {
      const pinned = Number(isPinnedWorktree(b)) - Number(isPinnedWorktree(a))
      if (pinned !== 0) return pinned
    }
    if (sort === 'recently-updated') {
      const byDate = byDateDescending(
        a.status?.lastCommit?.date ?? null,
        b.status?.lastCommit?.date ?? null
      )
      if (byDate !== 0) return byDate
    }
    return byName(worktreeTitle(a), worktreeTitle(b))
  })
}

/** The same two orders for the Remote Branches list, which has nothing to pin. */
export function sortRemoteBranches(
  branches: readonly RemoteBranch[],
  sort: ListSort
): RemoteBranch[] {
  return [...branches].sort((a, b) => {
    if (sort === 'recently-updated') {
      const byDate = byDateDescending(a.lastCommit?.date ?? null, b.lastCommit?.date ?? null)
      if (byDate !== 0) return byDate
    }
    return byName(a.name, b.name)
  })
}

/**
 * Case-insensitive substring matching, on whichever of a row's names the
 * user can actually see. Substring rather than fuzzy or prefix: a worktree
 * on `feature/JIRA-4021-thing` is most often looked for by the ticket
 * number in the middle of it, which a prefix match would never find, and a
 * fuzzy match on a list this short mostly buys false positives.
 *
 * An empty or whitespace-only query matches everything, so clearing the box
 * is the same thing as not having opened it.
 */
function matches(query: string, ...fields: (string | null)[]): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return fields.some((field) => field !== null && field.toLowerCase().includes(needle))
}

/**
 * Worktrees matching `query`, by branch name, by the title the row shows
 * (which is where a detached worktree's label lives), and by path — the
 * path because two worktrees on similarly-named branches are told apart by
 * their folder, and it is on screen in the detail pane.
 */
export function filterWorktrees(worktrees: readonly Worktree[], query: string): Worktree[] {
  return worktrees.filter((worktree) =>
    matches(query, worktree.branch, worktreeTitle(worktree), worktree.path)
  )
}

/** Remote branches matching `query`, by full ref name or by short name. */
export function filterRemoteBranches(
  branches: readonly RemoteBranch[],
  query: string
): RemoteBranch[] {
  return branches.filter((branch) => matches(query, branch.name, branch.shortName))
}
