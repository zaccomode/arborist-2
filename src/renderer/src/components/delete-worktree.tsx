import { useRef, useState } from 'react'
import type { Worktree } from '@shared/domain'
import { worktreeTitle } from '@shared/format'
import { createPendingStep } from '@shared/pending-step'
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
import { CopyableError } from '@/components/copyable-error'
import { invoke } from '@/api/client'
import { handOffFocusReturn, returnFocusToMenu } from '@/lib/menu-opens-dialog'

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

  // Dismissing the first dialog while `isDirty` is still out calls off
  // whatever its answer would have done (#161).
  const pending = useRef(createPendingStep()).current

  const handleOpenChange = (next: boolean): void => {
    if (!next) pending.cancel()
    onOpenChange(next)
  }

  const confirmFirst = async (): Promise<void> => {
    setError(null)
    const live = pending.begin()
    let dirty: boolean
    try {
      // A prunable worktree has no directory left to inspect, so there is
      // nothing to lose and nothing to ask about.
      dirty = worktree.prunable ? false : await invoke('worktrees:isDirty', worktree.path)
    } catch (cause) {
      if (live()) setError((cause as Error).message)
      return
    }
    if (!live()) return
    if (dirty) {
      // The second question replaces the first rather than stacking on it:
      // two modals at once trap focus in the wrong one. The way back to the
      // menu that opened the first passes to the second (#156).
      handOffFocusReturn()
      onOpenChange(false)
      setConfirmingForce(true)
      return
    }
    await remove(worktree.prunable)
  }

  return (
    <>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent
          data-testid="delete-worktree-dialog"
          onCloseAutoFocus={returnFocusToMenu}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {worktreeTitle(worktree)}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the worktree directory and its files. The branch itself is left alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <CopyableError className="text-sm" message={error} />}
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
        <AlertDialogContent
          data-testid="force-delete-worktree-dialog"
          onCloseAutoFocus={returnFocusToMenu}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{worktreeTitle(worktree)} has uncommitted changes</AlertDialogTitle>
            <AlertDialogDescription>
              Force deleting will permanently discard them. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <CopyableError className="text-sm" message={error} />}
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
