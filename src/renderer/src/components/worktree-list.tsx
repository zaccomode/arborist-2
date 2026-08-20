import { GitBranch, House } from 'lucide-react'
import type { Worktree } from '@shared/domain'
import { formatRelativeDate, worktreeTitle } from '@shared/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { WorktreeBadges } from '@/components/worktree-badges'

function metadataLine(worktree: Worktree): string {
  const commit = worktree.status?.lastCommit
  if (!commit) return worktree.prunable ? 'Folder missing' : ''
  return [formatRelativeDate(commit.date), commit.author, commit.shortHash]
    .filter(Boolean)
    .join(' • ')
}

export function WorktreeList({
  worktrees,
  loading,
  selectedPath,
  onSelect
}: {
  worktrees: Worktree[]
  loading: boolean
  selectedPath: string | null
  onSelect: (path: string) => void
}): React.JSX.Element {
  if (loading) {
    return (
      <div className="space-y-1 p-1">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-11 w-full" />
        ))}
      </div>
    )
  }

  if (worktrees.length === 0) {
    return <p className="px-2 py-1 text-sm text-muted-foreground">No worktrees yet.</p>
  }

  return (
    <ul className="space-y-0.5">
      {worktrees.map((worktree) => {
        const selected = worktree.path === selectedPath
        const metadata = metadataLine(worktree)

        return (
          <li key={worktree.path}>
            <button
              type="button"
              onClick={() => onSelect(worktree.path)}
              aria-current={selected}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                selected && 'bg-accent hover:bg-accent'
              )}
            >
              {worktree.isMain ? (
                <House className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <GitBranch className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {worktreeTitle(worktree)}
                </span>
                {metadata && (
                  <span className="block truncate text-xs text-muted-foreground">{metadata}</span>
                )}
              </span>
              <WorktreeBadges worktree={worktree} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
