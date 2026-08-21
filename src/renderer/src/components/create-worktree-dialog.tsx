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
import { invoke } from '@/api/client'

const EXISTENCE_DEBOUNCE_MS = 250

export function CreateWorktreeDialog({
  open,
  onOpenChange,
  repoPath,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoPath: string
  onCreated: (worktreePath: string) => void
}): React.JSX.Element {
  const [raw, setRaw] = useState('')
  const [path, setPath] = useState('')
  // Null while the user hasn't touched the location, so it keeps following
  // the branch name until they take it over.
  const [pathEdited, setPathEdited] = useState(false)
  const [checked, setChecked] = useState<{ branch: string; exists: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const branch = parseBranchInput(raw)
  const validation = validateBranchName(branch)
  const interpreted = branch !== raw.trim() && branch.length > 0

  const setOpen = (next: boolean): void => {
    if (!next) {
      setRaw('')
      setPath('')
      setPathEdited(false)
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
      if (!pathEdited) void invoke('worktrees:suggestPath', repoPath, branch).then(setPath)
    }, EXISTENCE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [branch, validation.valid, pathEdited, repoPath])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    setCreating(true)
    try {
      const created = await invoke('worktrees:create', repoPath, { branch, path })
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
              Paste a branch name, or the whole checkout command it came in.
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
                  : 'New branch, created from the current HEAD.'}
              </p>
            )}
          </div>

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
            <p data-testid="create-worktree-error" className="mt-3 text-sm text-destructive">
              {error}
            </p>
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
