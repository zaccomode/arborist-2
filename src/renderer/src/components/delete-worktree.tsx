import { useState } from 'react'
import type { Worktree } from '@shared/domain'
import { worktreeTitle } from '@shared/format'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { invoke } from '@/api/client'

/**
 * Deleting a worktree in two stages, the way v1 did, but decided by a fresh
 * `status` rather than by matching git's stderr for "modified or untracked
 * files". Same flow, and it survives git rewording its errors.
 *
 * The branch is never deleted, only the worktree.
 */
export function DeleteWorktreeDialogs({
  worktree,
  repoPath,
  open,
  onOpenChange,
  onDeleted
}: {
  worktree: Worktree
  repoPath: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}): React.JSX.Element {
  const [confirmingForce, setConfirmingForce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async (force: boolean): Promise<void> => {
    setError(null)
    try {
      await invoke('worktrees:remove', repoPath, worktree.path, force)
      setConfirmingForce(false)
      onOpenChange(false)
      onDeleted()
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const confirmFirst = async (): Promise<void> => {
    setError(null)
    // A prunable worktree has no directory left to inspect, so there is
    // nothing to lose and nothing to ask about.
    const dirty = worktree.prunable ? false : await invoke('worktrees:isDirty', worktree.path)
    if (dirty) {
      setConfirmingForce(true)
      return
    }
    await remove(worktree.prunable)
  }

  return (
    <>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent data-testid="delete-worktree-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {worktreeTitle(worktree)}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the worktree directory and its files. The branch itself is left alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Held open, because the answer to "is it dirty" decides
                // whether a second question follows.
                event.preventDefault()
                void confirmFirst()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmingForce} onOpenChange={setConfirmingForce}>
        <AlertDialogContent data-testid="force-delete-worktree-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{worktreeTitle(worktree)} has uncommitted changes</AlertDialogTitle>
            <AlertDialogDescription>
              Force deleting will permanently discard them. There is no way back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void remove(true)
              }}
            >
              Force delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
