import { useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { ChangedFile } from '@shared/domain'
import { stashScope } from '@shared/working-tree'
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
import { invoke } from '@/api/client'
import { queryKeys } from '@/api/queries'

/**
 * The Changed Files header's "Stash…" trigger (#69 review): moved here from
 * the Stash section below it, which now only lists existing stashes. Scoped
 * to whatever's currently checked for staging — `stashScope` reuses that
 * state as the selection rather than a parallel model, since "checked" and
 * "selected" are already the same thing in this list.
 *
 * Nothing checked falls back to stashing everything, the same one-click
 * behaviour this replaces, rather than disabling the menu item: staging
 * something first isn't how most people reach for "stash my changes", so
 * disabling it there would make the common case an extra click for no
 * benefit — the scoping is an opt-in refinement, not a new requirement.
 */
export function NewStashMenu({
  repoPath,
  worktreePath,
  files
}: {
  repoPath: string
  worktreePath: string
  files: ChangedFile[]
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const { files: selected, paths } = stashScope(files)
  const scoped = paths !== null

  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(false)
  const [creating, setCreating] = useState(false)

  const submitStash = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setCreating(true)
    try {
      const stashed = await invoke('stash:push', worktreePath, message, includeUntracked, paths)
      toast(stashed ? 'Changes stashed.' : 'Nothing to stash — the working tree is clean.')
      queryClient.invalidateQueries({ queryKey: queryKeys.stashes(worktreePath) })
      queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(worktreePath) })
      queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
      setOpen(false)
      setMessage('')
      setIncludeUntracked(false)
    } catch (cause) {
      toast.error('Stash failed', { description: (cause as Error).message })
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Changed files actions"
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            {scoped
              ? `Stash ${selected.length} selected file${selected.length === 1 ? '' : 's'}…`
              : 'Stash all changes…'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="new-stash-dialog">
          <form onSubmit={(event) => void submitStash(event)}>
            <DialogHeader>
              <DialogTitle>Stash changes</DialogTitle>
              <DialogDescription>
                {scoped
                  ? `Sets the ${selected.length} selected file${selected.length === 1 ? '' : 's'} aside, to bring back later.`
                  : 'Sets your uncommitted changes aside, to bring back later.'}
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

            {/* An untracked file's checkbox is always unchecked (it has
                nothing staged), so it can never be part of a scoped
                selection — offering to include untracked files here would
                promise something a scoped stash can't do. */}
            {!scoped && (
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
            )}

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
    </>
  )
}
