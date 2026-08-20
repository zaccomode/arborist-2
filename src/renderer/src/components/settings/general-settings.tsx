import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Settings } from '@shared/persisted'
import { Button } from '@/components/ui/button'
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
  const [gitPath, setGitPath] = useState(settings.gitPath ?? '')

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
          <p className="text-xs text-destructive">{git.data.overrideError}</p>
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
