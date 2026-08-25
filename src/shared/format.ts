import type { Worktree } from './domain'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The sidebar's date, in the shape the concept design asks for: "Today",
 * "Yesterday", "2 days ago", then a plain date once the count stops meaning
 * anything.
 */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const elapsed = now.getTime() - then.getTime()
  if (elapsed < MINUTE) return 'Just now'
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (then.getTime() >= startOfToday) return 'Today'
  if (then.getTime() >= startOfToday - DAY) return 'Yesterday'

  const days = Math.floor((startOfToday - then.getTime()) / DAY) + 1
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  }
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * A commit's age, compact enough to sit beside its absolute date: "4d",
 * "2h", never a whole sentence the way `formatRelativeDate` reads in the
 * sidebar, since the Recent Commits panel already spends words on the
 * subject and author.
 */
function compactAge(iso: string, now: Date): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const elapsed = Math.max(0, now.getTime() - then.getTime())
  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d`
  if (elapsed < 365 * DAY) return `${Math.floor(elapsed / (30 * DAY))}mo`
  return `${Math.floor(elapsed / (365 * DAY))}y`
}

/**
 * A commit's timestamp for the Recent Commits panel: age and absolute date
 * together, e.g. "4d (13 July 2026 at 21:19)", so the card reads at a glance
 * without hiding exactly when the commit landed.
 */
export function formatCommitTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const date = then.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  const time = then.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  return `${compactAge(iso, now)} (${date} at ${time})`
}

/** What the sidebar and the detail pane call a worktree. */
export function worktreeTitle(worktree: Worktree): string {
  if (worktree.branch) return worktree.branch
  if (worktree.head) return `detached at ${worktree.head.slice(0, 7)}`
  return worktree.path
}

/**
 * The refs the commit graph logs: the worktree's own tip (its branch, or
 * HEAD when detached) plus its upstream, when one is configured and hasn't
 * been deleted on the remote (`WorktreeStatus.gone`) — "local and remote on
 * this branch," per the concept note. Empty only for a worktree with
 * neither a branch nor a resolvable HEAD (a bare repository's own entry),
 * which has nothing to log at all.
 */
export function commitGraphTips(worktree: Worktree): string[] {
  const tip = worktree.branch ?? worktree.head
  if (!tip) return []
  const status = worktree.status
  const upstream = status && !status.gone ? status.upstream : null
  return upstream && upstream !== tip ? [tip, upstream] : [tip]
}

/**
 * What the Commit Graph tab heads itself with, so its scope reads as
 * intentional rather than broken: "local and remote on this branch" is
 * usually a near-straight line with the occasional fork, and users expect
 * the graph to show every branch. Naming the two tips it actually covers —
 * "main and origin/main" — is the honest alternative to widening the query
 * to `--branches`, which would be expensive and noisy for what the concept
 * actually asks for.
 */
export function commitGraphScopeLabel(worktree: Worktree): string {
  const tips = commitGraphTips(worktree)
  if (tips.length === 0) return ''
  // `worktreeTitle` already renders a detached HEAD short and labelled
  // ("detached at ab12345") rather than the raw 40-character hash
  // `commitGraphTips` needs for the actual git invocation.
  const tipLabel = worktreeTitle(worktree)
  const upstream = tips[1]
  return upstream ? `${tipLabel} and ${upstream}` : tipLabel
}

/**
 * The worktree's relationship with its upstream, as a sentence. The sidebar
 * has room for a couple of arrows; the detail pane has room for words.
 */
export function syncSummary(worktree: Worktree): string {
  const status = worktree.status
  if (!status) return worktree.statusError ? 'Status unavailable' : 'Checking…'
  if (worktree.prunable) return 'Folder missing'
  if (!status.upstream) return 'No upstream branch'
  if (status.gone) return `${status.upstream} was deleted`
  if (status.ahead && status.behind) {
    return `\u2191${status.ahead} \u2193${status.behind} from ${status.upstream}`
  }
  if (status.ahead) return `\u2191${status.ahead} ahead of ${status.upstream}`
  if (status.behind) return `\u2193${status.behind} behind ${status.upstream}`
  return `Up-to-date with ${status.upstream}`
}
