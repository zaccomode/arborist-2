import { useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { Worktree } from '@shared/domain'
import { Button } from '@/components/ui/button'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { BranchCombobox, type BaseRefOption } from '@/components/branch-combobox'
import { invoke } from '@/api/client'
import { queryKeys, useLocalBranches } from '@/api/queries'
import { useWorktreeInspector } from '@/state/selection'

/**
 * The uncommitted-changes conflict this dialog can hand off to, once the
 * user picks Stash and switch or Commit first.
 */
interface Conflict {
  branch: string
  paths: string[]
}

/**
 * "Switch branch…" from the worktree actions dropdown (#51). Every failure
 * mode `git switch` can hit is pre-checked by `branches:switchPrecheck`
 * before this ever calls `branches:switch`, so the two indistinguishable
 * 128s (branch missing vs. checked out elsewhere) never have to be told
 * apart from an exit code.
 *
 * The conflict `AlertDialog` replaces the picker rather than stacking on it —
 * the same two-stage shape `DeleteWorktreeDialogs` uses — and offers no force
 * or discard option: deleting work behind one confirmation isn't something
 * this app should do.
 */
export function SwitchBranchDialog({
  open,
  onOpenChange,
  repoPath,
  projectId,
  worktree,
  onCommitFirst
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoPath: string
  projectId: string
  worktree: Worktree
  /** Switches to the Working Tree tab and focuses the commit box. */
  onCommitFirst: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [, , closeInspector] = useWorktreeInspector(projectId, worktree.path)
  const localBranches = useLocalBranches(open ? repoPath : null)

  const [branch, setBranch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  const options: BaseRefOption[] = (localBranches.data ?? [])
    .filter((entry) => entry.name !== worktree.branch)
    .map((entry) => ({ value: entry.name, label: entry.name, group: 'local' as const }))

  /**
   * Closes the picker and clears its fields, so the next open starts fresh
   * rather than showing whatever was left from before — including the
   * transition into the conflict `AlertDialog`, which captures what it needs
   * into `conflict` before this runs.
   */
  const setOpen = (next: boolean): void => {
    if (!next) {
      setBranch('')
      setError(null)
    }
    onOpenChange(next)
  }

  const afterSwitch = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(worktree.path) })
    // Prefix match: the exact key carries the *old* branch as its ref, which
    // is exactly the query this switch just made stale.
    queryClient.invalidateQueries({ queryKey: ['commits', repoPath] })
    closeInspector()
  }

  const finishSwitch = async (target: string, carriesChanges: boolean): Promise<void> => {
    await invoke('branches:switch', worktree.path, target)
    afterSwitch()
    if (carriesChanges) toast('Your uncommitted changes came with you.')
    setOpen(false)
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!branch) return
    setError(null)
    setBusy(true)
    try {
      const plan = await invoke('branches:switchPrecheck', repoPath, worktree.path, branch)
      switch (plan.outcome) {
        case 'branch-missing':
          setError('That branch no longer exists.')
          break
        case 'in-use':
          setError(`${branch} is already checked out at ${plan.path}.`)
          break
        case 'unmerged':
          setError('Resolve the unmerged files in the Working Tree tab before switching branches.')
          break
        case 'conflicting':
          // Hands off to the AlertDialog below rather than stacking under it
          // — captured first, since closing resets `branch`.
          setConflict({ branch, paths: plan.paths })
          setOpen(false)
          break
        case 'clear':
          await finishSwitch(branch, plan.carriesChanges)
          break
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const stashAndSwitch = async (): Promise<void> => {
    if (!conflict) return
    setError(null)
    setBusy(true)
    try {
      await invoke('stash:push', worktree.path, `Arborist: switching to ${conflict.branch}`, true)
      await invoke('branches:switch', worktree.path, conflict.branch)
      afterSwitch()
      toast('Stashed your changes and switched branches.', {
        description: 'Pop the stash from the Stash section when you want them back.'
      })
      setConflict(null)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const commitFirst = (): void => {
    setConflict(null)
    onCommitFirst()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="switch-branch-dialog">
          <form onSubmit={(event) => void submit(event)}>
            <DialogHeader>
              <DialogTitle>Switch branch</DialogTitle>
              <DialogDescription>Check out a different branch in this worktree.</DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-2">
              <Label htmlFor="switch-branch">Branch</Label>
              <BranchCombobox
                value={branch}
                onChange={setBranch}
                options={options}
                loading={localBranches.isPending}
              />
            </div>

            {error && (
              <p data-testid="switch-branch-error" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!branch || busy}>
                Switch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={conflict !== null} onOpenChange={(next) => !next && setConflict(null)}>
        <AlertDialogContent data-testid="switch-branch-conflict-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switching to {conflict?.branch} would overwrite uncommitted changes
            </AlertDialogTitle>
            <AlertDialogDescription>
              These files differ on both sides and can&apos;t just carry over:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-40 overflow-y-auto rounded-md border px-3 py-2 font-mono text-xs">
            {conflict?.paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="button" variant="outline" disabled={busy} onClick={commitFirst}>
              Commit first
            </Button>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void stashAndSwitch()
              }}
            >
              Stash and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
