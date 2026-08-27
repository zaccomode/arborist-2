import { useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { StashEntry } from '@shared/domain'
import { formatRelativeDate } from '@shared/format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyableError } from '@/components/copyable-error'
import { invoke } from '@/api/client'
import { queryKeys, useStashes } from '@/api/queries'
import { showErrorToast } from '@/lib/error-toast'

/**
 * The "pop left conflicts" toast text a conflicting pop or apply produces —
 * a real conflict-resolution UI is a later phase (#53); this phase only has
 * to surface it honestly rather than pretending it didn't happen.
 */
function conflictToast(): void {
  showErrorToast('That left conflicts to resolve', {
    description: 'Resolve them in the Working Tree tab, or drop the stash to give up on it.'
  })
}

function StashRow({
  entry,
  worktreePath,
  onChanged
}: {
  entry: StashEntry
  worktreePath: string
  onChanged: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)

  const run = async (action: 'pop' | 'apply' | 'drop'): Promise<void> => {
    setBusy(true)
    try {
      if (action === 'drop') {
        await invoke('stash:drop', worktreePath, entry.ref)
        toast('Stash dropped.')
      } else {
        const result = await invoke(
          action === 'pop' ? 'stash:pop' : 'stash:apply',
          worktreePath,
          entry.ref
        )
        if (result.conflict) conflictToast()
        else toast(action === 'pop' ? 'Stash popped.' : 'Stash applied.')
      }
      onChanged()
    } catch (cause) {
      showErrorToast('That failed', { description: (cause as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate">{entry.message}</p>
        <p className="text-xs text-muted-foreground">{formatRelativeDate(entry.date)}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${entry.message} actions`}
            disabled={busy}
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void run('pop')}>Pop</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run('apply')}>Apply</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => void run('drop')}>
            Drop
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/**
 * The Working Tree tab's Stash section (#51), below Changed Files: the list
 * `git stash list` produces, each entry poppable, applicable, or droppable.
 * Pushing a new one lives on the Changed Files header instead (#69 review;
 * see `NewStashMenu`), scoped to whatever's checked there — this section is
 * the list alone. Switching branches onto conflicting changes also stashes
 * (see `SwitchBranchDialog`), which is what makes this necessary in the same
 * phase — the pop it offers there is never automatic.
 */
export function StashSection({
  repoPath,
  worktreePath
}: {
  repoPath: string
  worktreePath: string
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const query = useStashes(worktreePath)
  const entries = query.data ?? []

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.stashes(worktreePath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(worktreePath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
  }

  return (
    <section className="mt-6" data-testid="stash-section">
      <p className="text-xs font-medium text-muted-foreground">Stash</p>

      {query.isPending && (
        <div className="mt-2 space-y-2">
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {!query.isPending && entries.length === 0 && (
        <p className="mt-1 text-sm text-muted-foreground">No stashes.</p>
      )}

      {entries.length > 0 && (
        <ul data-testid="stash-list" className="mt-1 divide-y overflow-hidden rounded-lg border">
          {entries.map((entry) => (
            <StashRow
              key={entry.ref}
              entry={entry}
              worktreePath={worktreePath}
              onChanged={invalidate}
            />
          ))}
        </ul>
      )}

      {query.error && (
        <CopyableError className="mt-1 text-xs" message={(query.error as Error).message} />
      )}
    </section>
  )
}
