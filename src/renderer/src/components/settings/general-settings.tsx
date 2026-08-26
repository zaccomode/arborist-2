import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Settings } from '@shared/persisted'
import { Button } from '@/components/ui/button'
import { CopyableError } from '@/components/copyable-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { invoke } from '@/api/client'
import { useProjects } from '@/api/queries'
import { rootConflictsWithProject } from '@/lib/worktree-location'

const SOURCE_LABELS: Record<string, string> = {
  settings: 'the path set below',
  path: 'PATH',
  'known-location': 'a standard install location',
  none: 'nowhere'
}

export function GeneralSettings({
  settings,
  onChange
}: {
  settings: Settings
  onChange: (changes: Partial<Settings>) => void
}): React.JSX.Element {
  const git = useQuery({ queryKey: ['git-discovery'], queryFn: () => invoke('git:discover') })
  const projects = useProjects()
  const [gitPath, setGitPath] = useState(settings.gitPath ?? '')
  const [worktreeRootError, setWorktreeRootError] = useState<string | null>(null)

  return (
    <div className="space-y-6 py-2">
      <section className="space-y-2">
        <Label htmlFor="theme">Theme</Label>
        <Select
          value={settings.theme}
          onValueChange={(theme) => onChange({ theme: theme as Settings['theme'] })}
        >
          <SelectTrigger id="theme" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">Follow the system</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-2">
        <Label htmlFor="auto-fetch">Auto-fetch</Label>
        <p className="text-xs text-muted-foreground">
          Periodically fetches every open project&apos;s remotes while Arborist is focused. Off by
          default.
        </p>
        <Select
          value={String(settings.autoFetchIntervalMinutes)}
          onValueChange={(value) =>
            onChange({
              autoFetchIntervalMinutes: Number(value) as Settings['autoFetchIntervalMinutes']
            })
          }
        >
          <SelectTrigger id="auto-fetch" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Off</SelectItem>
            <SelectItem value="5">Every 5 minutes</SelectItem>
            <SelectItem value="15">Every 15 minutes</SelectItem>
            <SelectItem value="60">Every hour</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-2">
        <Label htmlFor="worktree-location">Worktree location</Label>
        <p className="text-xs text-muted-foreground">
          Where a new worktree&apos;s folder is created by default. A project can override this.
        </p>
        <Select
          value={settings.worktreeLocation}
          onValueChange={(value) =>
            onChange({ worktreeLocation: value as Settings['worktreeLocation'] })
          }
        >
          <SelectTrigger id="worktree-location" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="beside">Beside the repository</SelectItem>
            <SelectItem value="central">In a central directory</SelectItem>
          </SelectContent>
        </Select>
        {settings.worktreeLocation === 'central' && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const picked = await invoke('system:pickFolder')
                if (!picked) return
                const projectPaths = (projects.data ?? []).map((project) => project.path)
                if (rootConflictsWithProject(picked, projectPaths)) {
                  setWorktreeRootError(
                    'That folder is inside a project already in Arborist, so worktrees for every other project would show up as changes there.'
                  )
                  return
                }
                setWorktreeRootError(null)
                onChange({ worktreeRoot: picked })
              }}
            >
              Choose…
            </Button>
            <p
              className="flex-1 truncate font-mono text-xs text-muted-foreground"
              data-testid="worktree-root-path"
            >
              {settings.worktreeRoot ?? 'No directory chosen'}
            </p>
          </div>
        )}
        {worktreeRootError && <CopyableError className="text-xs" message={worktreeRootError} />}
      </section>

      <section className="space-y-2">
        <Label htmlFor="git-path">Git</Label>
        <p className="text-xs text-muted-foreground" data-testid="git-discovery">
          {git.data?.found
            ? `Using ${git.data.path} (${git.data.version}), found via ${SOURCE_LABELS[git.data.source]}.`
            : 'No git binary could be found.'}
        </p>
        <div className="flex gap-2">
          <Input
            id="git-path"
            spellCheck={false}
            className="font-mono text-xs"
            placeholder="Leave empty to search PATH and the usual locations"
            value={gitPath}
            onChange={(event) => setGitPath(event.target.value)}
          />
          <Button
            variant="outline"
            onClick={() => {
              onChange({ gitPath: gitPath.trim() ? gitPath.trim() : null })
              void git.refetch()
            }}
          >
            Use
          </Button>
        </div>
        {git.data?.overrideError && (
          <CopyableError className="text-xs" message={git.data.overrideError} />
        )}
      </section>

      {window.arborist.platform === 'win32' && (
        <section className="space-y-2">
          <Label htmlFor="automation-shell">Shell for setup automation</Label>
          <Select
            value={settings.automationShell}
            onValueChange={(shell) =>
              onChange({ automationShell: shell as Settings['automationShell'] })
            }
          >
            <SelectTrigger id="automation-shell" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="powershell">PowerShell</SelectItem>
              <SelectItem value="cmd">Command Prompt</SelectItem>
            </SelectContent>
          </Select>
          <Input
            spellCheck={false}
            className="font-mono text-xs"
            placeholder="Or a shell of your own, e.g. C:\\Program Files\\PowerShell\\7\\pwsh.exe"
            value={settings.customShellPath ?? ''}
            onChange={(event) =>
              onChange({
                customShellPath: event.target.value.trim() ? event.target.value : null,
                customShellArgs: ['-NoProfile', '-Command']
              })
            }
          />
        </section>
      )}
    </div>
  )
}
