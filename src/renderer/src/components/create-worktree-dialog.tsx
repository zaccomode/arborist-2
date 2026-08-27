import { useEffect, useState } from 'react'
import { parseBranchInput, validateBranchName } from '@shared/branch-name'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { BranchCombobox, type BaseRefOption } from '@/components/branch-combobox'
import { CopyableError } from '@/components/copyable-error'
import { useLocalBranches, useRemoteBranches } from '@/api/queries'
import { invoke } from '@/api/client'

const EXISTENCE_DEBOUNCE_MS = 250

export function CreateWorktreeDialog({
  open,
  onOpenChange,
  repoPath,
  projectId,
  onCreated,
  headLabel,
  trackRemote
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoPath: string
  projectId: string
  onCreated: (worktreePath: string) => void
  /** What the repository's current HEAD points at, for the base-ref picker's default entry. */
  headLabel?: string | null
  /**
   * Set for "Create worktree from this branch" on a remote-branch detail
   * pane: prefills the branch field with the remote's short name, and
   * creation tracks `ref` from birth regardless of what the branch field
   * ends up saying, since that is the entire point of opening the dialog
   * this way. The base-ref picker is hidden in this mode — the base is
   * already fixed and said in the description.
   *
   * The caller keys this component on `trackRemote`'s identity, so a fresh
   * mount is what seeds the field — there is no effect here reacting to it
   * changing after that.
   */
  trackRemote?: { ref: string; shortName: string } | null
}): React.JSX.Element {
  const [raw, setRaw] = useState(trackRemote?.shortName ?? '')
  const [path, setPath] = useState('')
  // Null while the user hasn't touched the location, so it keeps following
  // the branch name until they take it over.
  const [pathEdited, setPathEdited] = useState(false)
  const [baseRef, setBaseRef] = useState('')
  const [track, setTrack] = useState(false)
  const [checked, setChecked] = useState<{ branch: string; exists: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const localBranches = useLocalBranches(open ? repoPath : null)
  const remoteBranches = useRemoteBranches(open ? repoPath : null)

  const branch = parseBranchInput(raw)
  const validation = validateBranchName(branch)
  const interpreted = branch !== raw.trim() && branch.length > 0

  // A remote base matching the typed branch name by its short name is
  // almost certainly meant as a tracking checkout rather than an
  // independent branch that merely starts at the same commit.
  const selectedRemote = remoteBranches.data?.find((entry) => entry.name === baseRef)
  const suggestTracking = !trackRemote && !!selectedRemote && selectedRemote.shortName === branch
  const trackingRef = trackRemote?.ref ?? (track && suggestTracking ? baseRef : null)

  const baseRefOptions: BaseRefOption[] = [
    { value: '', label: `HEAD${headLabel ? ` (${headLabel})` : ''}`, group: 'head' },
    ...(localBranches.data ?? []).map((entry) => ({
      value: entry.name,
      label: entry.name,
      group: 'local' as const
    })),
    ...(remoteBranches.data ?? []).map((entry) => ({
      value: entry.name,
      label: entry.name,
      group: 'remote' as const
    }))
  ]

  const setOpen = (next: boolean): void => {
    if (!next) {
      setRaw('')
      setPath('')
      setPathEdited(false)
      setBaseRef('')
      setTrack(false)
      setChecked(null)
      setError(null)
    }
    onOpenChange(next)
  }

  useEffect(() => {
    if (!validation.valid) return
    // Debounced: each of these is a process spawn, and they would otherwise
    // run on every keystroke of a branch name.
    const timer = setTimeout(() => {
      void invoke('branches:exists', repoPath, branch).then((exists) =>
        setChecked({ branch, exists })
      )
      if (!pathEdited) {
        void invoke('worktrees:suggestPath', repoPath, branch, projectId).then(setPath)
      }
    }, EXISTENCE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [branch, validation.valid, pathEdited, repoPath, projectId])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    setCreating(true)
    try {
      const effectiveBaseRef = trackRemote ? trackRemote.ref : baseRef || null
      const effectiveTrack = trackRemote ? true : track && suggestTracking
      const created = await invoke('worktrees:create', repoPath, {
        branch,
        path,
        ...(effectiveBaseRef ? { baseRef: effectiveBaseRef } : {}),
        ...(effectiveTrack ? { track: true } : {})
      })
      onCreated(created)
      setOpen(false)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const blocked = !validation.valid || path.trim().length === 0 || creating

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="create-worktree-dialog">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New worktree</DialogTitle>
            <DialogDescription>
              {trackRemote
                ? `Creates a local branch tracking ${trackRemote.ref}.`
                : 'Paste a branch name, or the whole checkout command it came in.'}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="branch">Branch</Label>
            <Input
              id="branch"
              autoFocus
              spellCheck={false}
              value={raw}
              placeholder="feature/ABC-123"
              onChange={(event) => setRaw(event.target.value)}
            />
            {interpreted && (
              <p data-testid="branch-interpretation" className="text-xs text-muted-foreground">
                Interpreted as <span className="font-mono">{branch}</span>
              </p>
            )}
            {raw.trim().length > 0 && !validation.valid && (
              <p data-testid="branch-error" className="text-xs text-destructive">
                {validation.reason}
              </p>
            )}
            {validation.valid && checked?.branch === branch && (
              <p data-testid="branch-existence" className="text-xs text-muted-foreground">
                {checked.exists
                  ? 'Branch exists, and will be checked out here.'
                  : trackingRef
                    ? `New branch, tracking ${trackingRef}.`
                    : baseRef
                      ? `New branch, created from ${baseRef}.`
                      : 'New branch, created from the current HEAD.'}
              </p>
            )}
          </div>

          {!trackRemote && (
            <div className="mt-4 space-y-2">
              <Label htmlFor="base-ref">Base</Label>
              <BranchCombobox
                value={baseRef}
                onChange={setBaseRef}
                options={baseRefOptions}
                loading={localBranches.isPending || remoteBranches.isPending}
              />
            </div>
          )}

          {suggestTracking && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <Label htmlFor="track-remote" className="text-xs font-normal text-muted-foreground">
                {branch} matches {selectedRemote!.name} — track it, instead of just branching from
                it?
              </Label>
              <Switch id="track-remote" checked={track} onCheckedChange={setTrack} />
            </div>
          )}

          <div className="mt-4 space-y-2">
            <Label htmlFor="worktree-path">Location</Label>
            <div className="flex gap-2">
              <Input
                id="worktree-path"
                spellCheck={false}
                className="font-mono text-xs"
                value={path}
                onChange={(event) => {
                  setPathEdited(true)
                  setPath(event.target.value)
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const chosen = await invoke('system:pickFolder')
                  if (chosen) {
                    setPathEdited(true)
                    setPath(chosen)
                  }
                }}
              >
                Choose…
              </Button>
            </div>
          </div>

          {error && (
            <CopyableError
              testId="create-worktree-error"
              className="mt-3 text-sm"
              message={error}
            />
          )}

          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={blocked}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
