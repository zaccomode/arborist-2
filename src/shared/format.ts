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

/** What the sidebar and the detail pane call a worktree. */
export function worktreeTitle(worktree: Worktree): string {
  if (worktree.branch) return worktree.branch
  if (worktree.head) return `detached at ${worktree.head.slice(0, 7)}`
  return worktree.path
}
