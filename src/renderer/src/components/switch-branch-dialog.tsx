import { useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Cloud, GitBranch, GitBranchPlus, GitCommitHorizontal, Plus } from 'lucide-react'
import type { Worktree } from '@shared/domain'
import { validateBranchName } from '@shared/branch-name'
import { resolveSwitchTarget } from '@shared/branch-switch'
import {
  baseRows,
  filterRows,
  isAvailable,
  offerCreate,
  resolveDefaultBranch,
  switchRows,
  type BranchRow
} from '@shared/branch-picker'
import { formatRelativeDate } from '@shared/format'
import { Badge } from '@/components/ui/badge'
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
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { CopyableError } from '@/components/copyable-error'
import { invoke } from '@/api/client'
import {
  queryKeys,
  useLocalBranchDetails,
  useRemoteBranches,
  useRemoteHead,
  useWorktrees
} from '@/api/queries'
import { useWorktreeInspector } from '@/state/selection'

/** What creates the branch instead of merely switching to it: `null` start point means HEAD. */
type CreateOption = { startPoint: string | null } | null

/**
 * The uncommitted-changes conflict this dialog can hand off to, once the
 * user picks Stash and switch or Commit first.
 */
interface Conflict {
  branch: string
  paths: string[]
  /** Carried through so "Stash and switch" still creates the branch, if that's what this was. */
  create: CreateOption
}

/**
 * Which list the palette is showing: the branches to switch to, or — after
 * "Create branch … from…" — the start points for the new branch.
 */
type Step = { kind: 'branch' } | { kind: 'base'; branch: string }

/** The last row the keyboard (or pointer) moved to, and under which search it did. */
interface Navigation {
  context: string
  key: string
}

const CREATE_KEY = 'create'
const CREATE_FROM_KEY = 'create-from'

/** The final segment of a worktree path, to name it in a row without the whole path. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts[parts.length - 1] ?? path
}

/**
 * One branch in the palette: the name with what kind of branch it is, the
 * tip commit's subject beneath it, and the commit's age at the right — enough
 * to tell `feature/login` from `feature/login-v2` without leaving the
 * palette (#96).
 */
function BranchRowItem({
  row,
  onSelect
}: {
  row: BranchRow
  onSelect: () => void
}): React.JSX.Element {
  const Icon = row.kind === 'remote' ? Cloud : row.kind === 'head' ? GitCommitHorizontal : GitBranch
  const label = row.kind === 'head' ? `HEAD (${row.shortName})` : row.name
  const detail = row.checkedOutAt
    ? `Checked out in ${folderName(row.checkedOutAt)}`
    : (row.lastCommit?.subject ?? 'No commits yet')

  return (
    <CommandItem
      value={row.key}
      disabled={!isAvailable(row)}
      onSelect={onSelect}
      data-testid="branch-row"
      title={row.checkedOutAt ?? undefined}
      className="items-start py-1.5"
    >
      <Icon className="mt-0.5 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono">{label}</span>
          {row.isDefault && <Badge variant="outline">default</Badge>}
          {row.kind === 'remote' && <Badge variant="outline">remote</Badge>}
          {row.upstream && <span className="truncate text-muted-foreground">↑ {row.upstream}</span>}
        </div>
        <div className="truncate text-muted-foreground">{detail}</div>
      </div>
      {row.lastCommit && (
        <div className="shrink-0 text-right text-muted-foreground">
          <div className="font-mono">{row.lastCommit.shortHash}</div>
          <div>{formatRelativeDate(row.lastCommit.date)}</div>
        </div>
      )}
    </CommandItem>
  )
}

/**
 * "Switch branch…" from the worktree actions dropdown (#51), as a palette
 * pinned to the top of the window in the shape of VS Code's branch picker
 * (#96): a search field and the list, nothing else. Every branch shows from
 * the moment it opens, typing narrows it — see `filterRows` for how — and
 * the top row is always the one Enter picks. Picking a row *is* the
 * confirmation; there's no second button to press.
 *
 * Every failure mode `git switch` can hit is pre-checked by
 * `branches:switchPrecheck` before this ever calls `branches:switch`, so the
 * two indistinguishable 128s (branch missing vs. checked out elsewhere) never
 * have to be told apart from an exit code. A branch checked out in another
 * worktree is listed but can't be picked, and says where it is.
 *
 * The conflict `AlertDialog` replaces the palette rather than stacking on it
 * — the same two-stage shape `DeleteWorktreeDialogs` uses — and offers no
 * force or discard option: deleting work behind one confirmation isn't
 * something this app should do.
 *
 * A remote branch resolves through `resolveSwitchTarget` to the local branch
 * that tracks it (#86). A typed name that isn't a branch yet offers "Create
 * branch" (from HEAD) and "Create branch … from…", which swaps the list for
 * the start points to create it from (#69 review).
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
  const localBranches = useLocalBranchDetails(open ? repoPath : null)
  const remoteBranches = useRemoteBranches(open ? repoPath : null)
  const remoteHead = useRemoteHead(open ? repoPath : null)
  const worktrees = useWorktrees(repoPath)

  const [step, setStep] = useState<Step>({ kind: 'branch' })
  const [search, setSearch] = useState('')
  const [navigation, setNavigation] = useState<Navigation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  const local = localBranches.data ?? []
  const remote = remoteBranches.data ?? []
  const localNames = local.map((branch) => branch.name)
  const loading = localBranches.isPending || remoteBranches.isPending
  const defaultBranch = resolveDefaultBranch(
    remoteHead.data ?? null,
    localNames,
    remote.map((branch) => branch.shortName)
  )

  const rows = filterRows(
    step.kind === 'branch'
      ? switchRows({
          local,
          remote,
          worktrees: worktrees.data ?? [],
          worktreePath: worktree.path,
          defaultBranch,
          // The renderer has no `process` for the default to read.
          platform: window.arborist.platform
        })
      : baseRows({
          local,
          remote,
          defaultBranch,
          head: { branch: worktree.branch, lastCommit: worktree.status?.lastCommit ?? null }
        }),
    search
  )

  // Held back until the lists are in, so a name typed while they load isn't
  // offered as new for a moment and then turn out to exist.
  const typed = search.trim()
  const showCreate = step.kind === 'branch' && !loading && offerCreate(typed, localNames, remote)
  const createValidation = showCreate ? validateBranchName(typed) : null

  // The topmost row has focus whenever the search changes (#96); arrowing
  // away from it sticks only until the next keystroke. Tracking which search
  // the navigation happened under, rather than resetting it in an effect,
  // keeps that a pure function of state.
  const keys = [
    ...rows.filter(isAvailable).map((row) => row.key),
    ...(createValidation?.valid ? [CREATE_KEY, CREATE_FROM_KEY] : [])
  ]
  const context = `${step.kind}:${search}`
  const active =
    navigation && navigation.context === context && keys.includes(navigation.key)
      ? navigation.key
      : (keys[0] ?? '')

  /**
   * Closes the palette and clears it, so the next open starts fresh rather
   * than showing whatever was left from before — including the transition
   * into the conflict `AlertDialog`, which captures what it needs into
   * `conflict` before this runs.
   */
  const setOpen = (next: boolean): void => {
    if (!next) {
      setStep({ kind: 'branch' })
      setSearch('')
      setNavigation(null)
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
    queryClient.invalidateQueries({ queryKey: queryKeys.localBranches(repoPath) })
    // Creating a local branch from a remote one takes that remote branch out
    // of the sidebar's Remote Branches list, which now has a worktree on it.
    queryClient.invalidateQueries({ queryKey: queryKeys.remoteBranches(repoPath) })
    closeInspector()
  }

  const finishSwitch = async (
    branchName: string,
    carriesChanges: boolean,
    create: CreateOption,
    tracking: string | null
  ): Promise<void> => {
    await invoke('branches:switch', worktree.path, branchName, create)
    afterSwitch()
    if (create && tracking) toast(`Created ${branchName}, tracking ${tracking}.`)
    else if (create) toast(`Created ${branchName} and switched to it.`)
    else if (carriesChanges) toast('Your uncommitted changes came with you.')
    setOpen(false)
  }

  /**
   * Switches to `input` — a local name, a remote ref, or a typed new name —
   * running the precheck first. `startPoint` is set only by the create
   * flow's base step; everything else lets `resolveSwitchTarget` decide.
   */
  const switchTo = async (input: string, startPoint?: string | null): Promise<void> => {
    if (busy) return
    const target = resolveSwitchTarget(input, localNames, remote, null)
    if (!target.branch) return
    const create: CreateOption =
      startPoint !== undefined && target.create ? { startPoint } : target.create
    if (create && !target.tracking) {
      const validation = validateBranchName(target.branch)
      if (!validation.valid) {
        setError(validation.reason)
        return
      }
    }
    setError(null)
    setBusy(true)
    try {
      const plan = await invoke(
        'branches:switchPrecheck',
        repoPath,
        worktree.path,
        target.branch,
        create
      )
      switch (plan.outcome) {
        case 'branch-missing':
          setError('That branch no longer exists.')
          break
        case 'in-use':
          setError(`${target.branch} is already checked out at ${plan.path}.`)
          break
        case 'unmerged':
          setError('Resolve the unmerged files in the Working Tree tab before switching branches.')
          break
        case 'conflicting':
          // Hands off to the AlertDialog below rather than stacking under it
          // — captured first, since closing resets the palette.
          setConflict({ branch: target.branch, paths: plan.paths, create })
          setOpen(false)
          break
        case 'clear':
          await finishSwitch(target.branch, plan.carriesChanges, create, target.tracking)
          break
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pickRow = (row: BranchRow): void => {
    if (step.kind === 'base') void switchTo(step.branch, row.name || null)
    else void switchTo(row.name)
  }

  const beginCreateFrom = (): void => {
    setStep({ kind: 'base', branch: typed })
    setSearch('')
    setNavigation(null)
    setError(null)
  }

  const stashAndSwitch = async (): Promise<void> => {
    if (!conflict) return
    setError(null)
    setBusy(true)
    try {
      await invoke(
        'stash:push',
        worktree.path,
        `Arborist: switching to ${conflict.branch}`,
        true,
        null
      )
      await invoke('branches:switch', worktree.path, conflict.branch, conflict.create)
      afterSwitch()
      toast(
        conflict.create
          ? `Stashed your changes and created ${conflict.branch}.`
          : 'Stashed your changes and switched branches.',
        { description: 'Pop the stash from the Stash section when you want them back.' }
      )
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
        <DialogContent
          data-testid="switch-branch-dialog"
          showCloseButton={false}
          // Pinned near the top of the window, the way an editor's quick
          // pick sits, rather than centred like a form (#96).
          className="top-3 translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Switch branch</DialogTitle>
            <DialogDescription>
              {step.kind === 'base'
                ? `Pick where ${step.branch} starts from.`
                : 'Check out a different branch in this worktree.'}
            </DialogDescription>
          </DialogHeader>
          <Command
            shouldFilter={false}
            loop
            value={active}
            onValueChange={(key) => setNavigation({ context, key })}
            className="rounded-none"
          >
            <CommandInput
              autoFocus
              aria-label={step.kind === 'base' ? 'Search start points' : 'Search branches'}
              placeholder={
                step.kind === 'base'
                  ? `Create ${step.branch} from…`
                  : 'Select a branch to switch to, or type a new name'
              }
              value={search}
              onValueChange={setSearch}
              disabled={busy}
            />
            {error && (
              <CopyableError
                testId="switch-branch-error"
                className="px-3 pt-2 text-xs"
                message={error}
              />
            )}
            <CommandList className="max-h-[min(24rem,60vh)]">
              {!showCreate && (
                <CommandEmpty>{loading ? 'Loading branches…' : 'No matching branch.'}</CommandEmpty>
              )}
              {rows.length > 0 && (
                <CommandGroup>
                  {rows.map((row) => (
                    <BranchRowItem key={row.key} row={row} onSelect={() => pickRow(row)} />
                  ))}
                </CommandGroup>
              )}
              {showCreate && (
                <CommandGroup>
                  <CommandItem
                    value={CREATE_KEY}
                    disabled={!createValidation?.valid}
                    onSelect={() => void switchTo(typed)}
                  >
                    <Plus className="text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        Create branch <span className="font-mono">{typed}</span>
                      </div>
                      <div
                        data-testid="switch-branch-plan"
                        className={
                          createValidation?.valid
                            ? 'truncate text-muted-foreground'
                            : 'truncate text-destructive'
                        }
                      >
                        {createValidation?.valid
                          ? `From HEAD${worktree.branch ? ` (${worktree.branch})` : ''}`
                          : createValidation?.reason}
                      </div>
                    </div>
                  </CommandItem>
                  {createValidation?.valid && (
                    <CommandItem value={CREATE_FROM_KEY} onSelect={beginCreateFrom}>
                      <GitBranchPlus className="text-muted-foreground" />
                      <div className="min-w-0 flex-1 truncate">
                        Create branch <span className="font-mono">{typed}</span> from…
                      </div>
                    </CommandItem>
                  )}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      <AlertDialog open={conflict !== null} onOpenChange={(next) => !next && setConflict(null)}>
        <AlertDialogContent data-testid="switch-branch-conflict-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {conflict?.create ? 'Creating' : 'Switching to'} {conflict?.branch} would overwrite
              uncommitted changes
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
          {error && <CopyableError className="text-sm" message={error} />}
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
