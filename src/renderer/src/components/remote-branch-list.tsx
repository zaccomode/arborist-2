import { Cloud } from 'lucide-react'
import type { RemoteBranch } from '@shared/domain'
import { formatRelativeDate } from '@shared/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { NoListMatches } from '@/components/list-controls'

function metadataLine(branch: RemoteBranch): string {
  if (!branch.lastCommit) return ''
  return [
    formatRelativeDate(branch.lastCommit.date),
    branch.lastCommit.author,
    branch.lastCommit.shortHash
  ]
    .filter(Boolean)
    .join(' • ')
}

export function RemoteBranchList({
  branches,
  loading,
  query,
  selectedName,
  onSelect
}: {
  /** Already sorted and filtered — see `sortRemoteBranches`/`filterRemoteBranches`. */
  branches: RemoteBranch[]
  loading: boolean
  /** The active search, so an empty list can say which of the two emptinesses it is. */
  query: string
  selectedName: string | null
  onSelect: (name: string) => void
}): React.JSX.Element {
  if (loading) {
    return (
      <div className="space-y-1 p-1">
        {[0, 1].map((row) => (
          <Skeleton key={row} className="h-11 w-full" />
        ))}
      </div>
    )
  }

  if (branches.length === 0) {
    if (query.trim()) return <NoListMatches query={query} />
    return (
      <p className="px-2 py-1 text-sm text-muted-foreground">
        No remote branches without worktrees.
      </p>
    )
  }

  return (
    <ul data-testid="remote-branch-list" className="space-y-0.5">
      {branches.map((branch) => {
        const selected = branch.name === selectedName
        const metadata = metadataLine(branch)

        return (
          <li key={branch.name}>
            <button
              type="button"
              onClick={() => onSelect(branch.name)}
              aria-current={selected}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                selected && 'bg-accent hover:bg-accent'
              )}
            >
              <Cloud className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{branch.name}</span>
                {metadata && (
                  <span className="block truncate text-xs text-muted-foreground">{metadata}</span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
