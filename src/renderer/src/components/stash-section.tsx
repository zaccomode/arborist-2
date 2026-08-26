import { useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { StashEntry } from '@shared/domain'
import { formatRelativeDate } from '@shared/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
 * `git stash list` produces, each entry poppable, applicable, or droppable,
 * plus a way to push a new one. Switching branches onto conflicting changes
 * also stashes (see `SwitchBranchDialog`), which is what makes this
 * necessary in the same phase — the pop it offers there is never automatic.
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

  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(false)
  const [creating, setCreating] = useState(false)

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.stashes(worktreePath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(worktreePath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
  }

  const submitStash = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setCreating(true)
    try {
      const stashed = await invoke('stash:push', worktreePath, message, includeUntracked)
      toast(stashed ? 'Changes stashed.' : 'Nothing to stash — the working tree is clean.')
      invalidate()
      setOpen(false)
      setMessage('')
      setIncludeUntracked(false)
    } catch (cause) {
      showErrorToast('Stash failed', { description: (cause as Error).message })
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="mt-6" data-testid="stash-section">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Stash</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs font-normal text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          Stash changes…
        </Button>
      </div>

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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="new-stash-dialog">
          <form onSubmit={(event) => void submitStash(event)}>
            <DialogHeader>
              <DialogTitle>Stash changes</DialogTitle>
              <DialogDescription>
                Sets your uncommitted changes aside, to bring back later.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-2">
              <Label htmlFor="stash-message">Message</Label>
              <Input
                id="stash-message"
                autoFocus
                value={message}
                placeholder="Optional"
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Checkbox
                id="stash-untracked"
                checked={includeUntracked}
                onCheckedChange={(checked) => setIncludeUntracked(checked === true)}
              />
              <Label htmlFor="stash-untracked" className="text-sm font-normal">
                Include untracked files
              </Label>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                Stash
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
