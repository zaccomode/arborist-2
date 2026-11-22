import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { repoNameFor, type CloneProtocol, type PublishResult } from '@shared/github'
import type { Repository } from '@shared/persisted'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { CopyableError } from '@/components/copyable-error'
import { GitHubSignIn } from '@/components/github-sign-in'
import { invoke } from '@/api/client'
import { queryKeys, useGitHubOwners, useGitHubStatus, useLocalBranchDetails } from '@/api/queries'
import { returnFocusToMenu } from '@/lib/menu-opens-dialog'

/**
 * Publishes a project with no remote to GitHub (#150): creates the
 * repository under the account or an organisation the app is installed on,
 * private unless unticked, adds it as `origin`, and pushes whichever local
 * branches are ticked — the current one, to start with.
 */
export function PublishRepositoryDialog({
  open,
  onOpenChange,
  project,
  currentBranch,
  onPublished
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Repository
  /** The main worktree's branch, ticked to start with. */
  currentBranch: string | null
  onPublished: (result: PublishResult) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="publish-dialog"
        onCloseAutoFocus={returnFocusToMenu}
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Publish to GitHub</DialogTitle>
          <DialogDescription>
            Creates a GitHub repository for {project.name} and pushes to it.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <PublishForm
            project={project}
            currentBranch={currentBranch}
            onCancel={() => onOpenChange(false)}
            onPublished={onPublished}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PublishForm({
  project,
  currentBranch,
  onCancel,
  onPublished
}: {
  project: Repository
  currentBranch: string | null
  onCancel: () => void
  onPublished: (result: PublishResult) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const status = useGitHubStatus()
  const account = status.data?.account ?? null
  const owners = useGitHubOwners(!!account)
  const branches = useLocalBranchDetails(project.path)

  const [owner, setOwner] = useState<string | null>(null)
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [protocol, setProtocol] = useState<CloneProtocol>('https')
  // Null until the user touches a box, so the default follows the branch
  // list as it loads rather than being fixed before it arrives.
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status.isPending) return <Skeleton className="h-40 w-full" />
  if (status.isError) return <CopyableError className="text-sm" message={status.error.message} />
  if (!account) {
    return <GitHubSignIn reason="Sign in to GitHub to choose where to publish this repository." />
  }

  const branchNames = (branches.data ?? []).map((branch) => branch.name)
  const chosen =
    picked ?? new Set(branchNames.filter((branch) => branch === currentBranch).slice(0, 1))
  const effectiveOwner = owner ?? owners.data?.[0]?.login ?? null
  const repoName = repoNameFor(name)
  const allChosen = branchNames.length > 0 && branchNames.every((branch) => chosen.has(branch))

  const toggle = (branch: string, on: boolean): void => {
    const next = new Set(chosen)
    if (on) next.add(branch)
    else next.delete(branch)
    setPicked(next)
  }

  const publish = async (): Promise<void> => {
    if (!effectiveOwner || !repoName) return
    setError(null)
    setPublishing(true)
    try {
      const result = await invoke('github:publish', project.id, {
        owner: effectiveOwner,
        name: repoName,
        description,
        private: isPrivate,
        protocol,
        // In the list's own order, which is git's.
        branches: branchNames.filter((branch) => chosen.has(branch))
      })
      onPublished(result)
    } catch (cause) {
      const failure = cause as Error & { code?: string }
      if (failure.code === 'github-signed-out') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.github })
      }
      // A push that failed after the repository was created still published
      // it: the remote is in place, so the switcher should regroup.
      if (failure.code === 'publish-push-failed') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectRemoteLocations })
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectsHasRemote })
      }
      setError(failure.message)
    } finally {
      setPublishing(false)
    }
  }

  return (
    // `min-w-0` because the dialog lays its children out on a grid, where an
    // item is at least as wide as its widest content: without it a long
    // description or branch name widens the form past the dialog instead of
    // truncating.
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3">
        <Label htmlFor="publish-owner">Owner</Label>
        {owners.isPending ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <div className="flex items-center gap-2">
            <Select
              value={effectiveOwner ?? ''}
              onValueChange={setOwner}
              disabled={!owners.data?.length}
            >
              <SelectTrigger id="publish-owner" className="w-48">
                <SelectValue placeholder="No accounts" />
              </SelectTrigger>
              <SelectContent>
                {(owners.data ?? []).map((entry) => (
                  <SelectItem key={entry.login} value={entry.login}>
                    {entry.login}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="link"
              className="h-auto px-0 text-xs text-muted-foreground"
              onClick={() => void invoke('github:openPage', 'install')}
            >
              <Plus />
              Add an account
            </Button>
          </div>
        )}

        <Label htmlFor="publish-name">Name</Label>
        <Input
          id="publish-name"
          autoFocus
          spellCheck={false}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {name.trim() && repoName && repoName !== name.trim() && (
          <p
            className="col-start-2 -mt-1 text-xs text-muted-foreground"
            data-testid="publish-name-interpretation"
          >
            Will be created as <span className="font-mono">{repoName}</span>
          </p>
        )}

        <Label htmlFor="publish-description">Description</Label>
        <Input
          id="publish-description"
          placeholder="Optional"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <Label htmlFor="publish-protocol">Remote URL</Label>
        <Select value={protocol} onValueChange={(value) => setProtocol(value as CloneProtocol)}>
          <SelectTrigger id="publish-protocol" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="https">HTTPS</SelectItem>
            <SelectItem value="ssh">SSH</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {owners.isError && <CopyableError className="text-sm" message={owners.error.message} />}
      {owners.data?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Arborist isn’t installed on any account yet. Add one to publish to it.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <Label htmlFor="publish-private" className="flex-col items-start gap-0.5 font-normal">
          <span className="font-medium">Private</span>
          <span className="text-xs text-muted-foreground">
            Only people you give access to can see it.
          </span>
        </Label>
        <Switch id="publish-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Branches to push</Label>
          {branchNames.length > 1 && (
            <Button
              type="button"
              variant="link"
              className="h-auto px-0 text-xs"
              onClick={() => setPicked(allChosen ? new Set() : new Set(branchNames))}
            >
              {allChosen ? 'Select none' : 'Select all'}
            </Button>
          )}
        </div>
        <div
          className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2"
          data-testid="publish-branches"
        >
          {branches.isPending && <Skeleton className="h-6 w-full" />}
          {branches.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No branches with commits yet, so nothing will be pushed.
            </p>
          )}
          {branchNames.map((branch) => (
            <label
              key={branch}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={chosen.has(branch)}
                onCheckedChange={(value) => toggle(branch, value === true)}
              />
              <span className="truncate font-mono text-xs">{branch}</span>
            </label>
          ))}
        </div>
      </div>

      {error && <CopyableError testId="publish-error" className="text-sm" message={error} />}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => void publish()}
          disabled={!effectiveOwner || !repoName || publishing}
        >
          {publishing && <Loader2 className="animate-spin" />}
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </DialogFooter>
    </div>
  )
}
