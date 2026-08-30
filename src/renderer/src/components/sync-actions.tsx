import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { Worktree } from '@shared/domain'
import { PULL_MODE_LABELS, pullLabel, syncAvailability, type PullMode } from '@shared/sync'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { invoke } from '@/api/client'
import { queryKeys } from '@/api/queries'
import { showErrorToast } from '@/lib/error-toast'

/**
 * Pull and push for the selected worktree's branch (#78), in the detail
 * pane's header beside Refresh.
 *
 * The header rather than the Working Tree tab because this is about the
 * branch against its upstream, which is what the chip row underneath already
 * describes — `syncSummary`'s "↑2 ↓1 from origin/main" is the sentence these
 * two buttons act on. The commit box keeps its own push, which is a
 * different moment: there it is the last step of committing, with your hands
 * already in that panel. Two ways to push is a small redundancy, and the
 * alternative — making someone open a tab to publish a branch they are
 * looking at the ahead count for — is a worse one.
 *
 * Pull is a split button: the main half fast-forwards, and the menu holds
 * rebase and merge for when it cannot. A diverged branch turns the refusal
 * into that offer rather than an error, since `--ff-only` refusing is an
 * answer and not a failure — see `GitService.pull`.
 */
export function SyncActions({
  repoPath,
  worktree
}: {
  repoPath: string
  worktree: Worktree
}): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<'pull' | 'push' | null>(null)
  const { visible, canPull, pushEnabled, behind, ahead, hasUpstream } = syncAvailability(worktree)
  const worktreePath = worktree.path

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.remoteBranches(repoPath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(worktreePath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.conflictState(worktreePath) })
    // A pull moves the branch pointer, so every open commit query on this
    // repository resets to page 0 — see `useCommitLog` on why resetting
    // rather than patching a page is what keeps `--skip` paging safe.
    queryClient.invalidateQueries({ queryKey: ['commits', repoPath] })
  }

  const runPull = async (mode: PullMode): Promise<void> => {
    setBusy('pull')
    try {
      const result = await invoke('workingTree:pull', worktreePath, mode)
      if (result.diverged) {
        showErrorToast('This branch and its upstream have both moved', {
          description:
            'A fast-forward is not possible. Use Pull and rebase, or Pull and merge, from the menu beside the button.'
        })
      } else if (result.conflict) {
        showErrorToast('That left conflicts to resolve', {
          description: 'Resolve them in the Working Tree tab, or abort from the Conflicts section.'
        })
      } else {
        toast(
          behind > 0 ? `Pulled ${behind} commit${behind === 1 ? '' : 's'}.` : 'Already up to date.'
        )
      }
      invalidate()
    } catch (cause) {
      showErrorToast('Pull failed', { description: (cause as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const runPush = async (): Promise<void> => {
    setBusy('push')
    try {
      await invoke('workingTree:push', worktreePath, worktree.branch ?? '', !hasUpstream)
      toast(hasUpstream ? 'Pushed.' : 'Branch published.')
      invalidate()
    } catch (cause) {
      showErrorToast('Push failed', { description: (cause as Error).message })
    } finally {
      setBusy(null)
    }
  }

  if (!visible) return null

  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="sync-actions">
      {canPull && (
        <ButtonGroup>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void runPull('ff-only')}
          >
            <ArrowDown />
            {pullLabel(behind)}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                aria-label="Pull options"
                disabled={busy !== null}
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void runPull('rebase')}>
                {PULL_MODE_LABELS.rebase}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void runPull('merge')}>
                {PULL_MODE_LABELS.merge}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={!pushEnabled || busy !== null}
        onClick={() => void runPush()}
      >
        <ArrowUp />
        {/* Short forms, not `pushLabel`'s sentences: this button sits in a
            header that already has a title, a path and two other controls in
            it, and the commit box a tab away is the one with room to spell
            "Publish branch" out. Keeping the two labels distinct also keeps
            them individually addressable, which a scenario driving either
            one needs. */}
        {hasUpstream ? `Push ${ahead}` : 'Publish'}
      </Button>
    </div>
  )
}
