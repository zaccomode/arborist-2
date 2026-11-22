import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderGit2, Globe, Loader2, Lock, Plus } from 'lucide-react'
import { filterRepos, groupReposByOwner, projectsByRepo, type CloneProtocol } from '@shared/github'
import type { Repository } from '@shared/persisted'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
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
import { CopyableError } from '@/components/copyable-error'
import { GitHubSignIn } from '@/components/github-sign-in'
import { invoke } from '@/api/client'
import {
  queryKeys,
  useGitHubRepos,
  useGitHubStatus,
  useProjectRemoteLocations,
  useProjects,
  useSettings
} from '@/api/queries'
import { returnFocusToMenu } from '@/lib/menu-opens-dialog'
import { childPath } from '@/lib/paths'

/**
 * Clones a GitHub repository and adds it as a project (#150): every
 * repository the Arborist app can reach, filtered as you type, cloned over
 * HTTPS or SSH into a folder picked each time that starts at the last one
 * used.
 */
export function CloneRepositoryDialog({
  open,
  onOpenChange,
  onCloned
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloned: (project: Repository) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="clone-dialog"
        onCloseAutoFocus={returnFocusToMenu}
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Clone from GitHub</DialogTitle>
          <DialogDescription>
            Copies a repository to this computer and adds it here.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts from a clean form. */}
        {open && <CloneForm onCancel={() => onOpenChange(false)} onCloned={onCloned} />}
      </DialogContent>
    </Dialog>
  )
}

function CloneForm({
  onCancel,
  onCloned
}: {
  onCancel: () => void
  onCloned: (project: Repository) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const status = useGitHubStatus()
  const settings = useSettings()
  const account = status.data?.account ?? null
  const repos = useGitHubRepos(!!account)
  const projects = useProjects()
  const locations = useProjectRemoteLocations()

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [protocol, setProtocol] = useState<CloneProtocol>('https')
  const [folder, setFolder] = useState<string | null>(null)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parent = folder ?? settings.data?.lastCloneFolder ?? null
  const groups = useMemo(
    () => groupReposByOwner(filterRepos(repos.data ?? [], query)),
    [repos.data, query]
  )
  const selected = repos.data?.find((repo) => repo.id === selectedId) ?? null
  // Repositories already cloned as a project. Cloning one again is allowed —
  // a second, separate copy is occasionally what someone wants — but it is
  // usually a mistake in an app built around worktrees, so it is flagged
  // and warned about rather than refused.
  const existing = useMemo(
    () => projectsByRepo(repos.data ?? [], projects.data ?? [], locations.data ?? {}),
    [repos.data, projects.data, locations.data]
  )
  const selectedExisting = selected ? (existing.get(selected.id) ?? null) : null

  if (status.isPending) {
    return <Skeleton className="h-40 w-full" />
  }
  if (status.isError) {
    return <CopyableError className="text-sm" message={status.error.message} />
  }
  if (!account) {
    return <GitHubSignIn reason="Sign in to GitHub to see the repositories Arborist can clone." />
  }

  const chooseFolder = async (): Promise<void> => {
    const picked = await invoke('system:pickFolder', {
      title: 'Choose where to clone into',
      defaultPath: parent
    })
    if (picked) setFolder(picked)
  }

  const clone = async (): Promise<void> => {
    if (!selected || !parent) return
    setError(null)
    setCloning(true)
    try {
      const project = await invoke('github:clone', selected.id, protocol, parent)
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      onCloned(project)
    } catch (cause) {
      const failure = cause as Error & { code?: string }
      if (failure.code === 'github-signed-out') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.github })
      }
      setError(failure.message)
    } finally {
      setCloning(false)
    }
  }

  return (
    // `min-w-0` because the dialog lays its children out on a grid, where an
    // item is at least as wide as its widest content: without it a long
    // description or branch name widens the form past the dialog instead of
    // truncating.
    <div className="min-w-0 space-y-4">
      <Command
        shouldFilter={false}
        className="h-auto rounded-lg border"
        data-testid="clone-repo-picker"
      >
        <CommandInput
          placeholder="Filter repositories…"
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
        <CommandList className="h-56 max-h-56">
          {repos.isPending && (
            <div className="space-y-2 p-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          )}
          {repos.isError && <CopyableError className="p-3 text-sm" message={repos.error.message} />}
          {repos.data && (
            <CommandEmpty>
              {repos.data.length === 0
                ? 'Arborist isn’t installed on any account with repositories yet.'
                : 'No repositories match.'}
            </CommandEmpty>
          )}
          {groups.map((group) => (
            <CommandGroup key={group.owner} heading={group.owner}>
              {group.repos.map((repo) => (
                <CommandItem
                  key={repo.id}
                  value={String(repo.id)}
                  onSelect={() => {
                    setSelectedId(repo.id)
                    setError(null)
                  }}
                  data-checked={repo.id === selectedId}
                  className="gap-2"
                >
                  {repo.private ? (
                    <Lock className="text-muted-foreground" aria-label="Private" />
                  ) : (
                    <Globe className="text-muted-foreground" aria-label="Public" />
                  )}
                  <span className="truncate">{repo.name}</span>
                  {repo.description && (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {repo.description}
                    </span>
                  )}
                  {existing.has(repo.id) && (
                    <Badge variant="outline" className="ml-auto shrink-0">
                      In Arborist
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3">
        <Label htmlFor="clone-protocol">Clone with</Label>
        <Select value={protocol} onValueChange={(value) => setProtocol(value as CloneProtocol)}>
          <SelectTrigger id="clone-protocol" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="https">HTTPS</SelectItem>
            <SelectItem value="ssh">SSH</SelectItem>
          </SelectContent>
        </Select>

        <Label htmlFor="clone-folder">Into</Label>
        <div className="flex min-w-0 gap-2">
          <Input
            id="clone-folder"
            readOnly
            className="font-mono text-xs"
            placeholder="Choose a folder"
            value={parent ?? ''}
            onClick={() => void chooseFolder()}
          />
          <Button type="button" variant="outline" onClick={() => void chooseFolder()}>
            Choose…
          </Button>
        </div>
      </div>

      {selected && parent && (
        <p className="text-xs text-muted-foreground" data-testid="clone-destination">
          Clones into <span className="font-mono">{childPath(parent, selected.name)}</span>
        </p>
      )}
      {protocol === 'ssh' && (
        <p className="text-xs text-muted-foreground">
          SSH uses your own SSH keys, not your Arborist sign-in.
        </p>
      )}

      {selected && selectedExisting && (
        <Alert data-testid="clone-already-added">
          <FolderGit2 />
          <AlertTitle>{selected.fullName} is already in Arborist</AlertTitle>
          <AlertDescription>
            It&apos;s the {selectedExisting.name} project. Are you sure you want to clone a second,
            separate copy? A new worktree is usually what you want instead.
          </AlertDescription>
        </Alert>
      )}

      {error && <CopyableError testId="clone-error" className="text-sm" message={error} />}

      <DialogFooter className="items-center sm:justify-between">
        <Button
          type="button"
          variant="link"
          className="h-auto px-0 text-xs text-muted-foreground"
          onClick={() => void invoke('github:openPage', 'install')}
        >
          <Plus />
          Add an account or organisation
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void clone()} disabled={!selected || !parent || cloning}>
            {cloning && <Loader2 className="animate-spin" />}
            {cloning ? 'Cloning…' : 'Clone'}
          </Button>
        </div>
      </DialogFooter>
    </div>
  )
}
