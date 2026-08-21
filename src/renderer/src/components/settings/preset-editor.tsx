import { useState } from 'react'
import type { Preset, PresetCommand } from '@shared/persisted'
import { findUnknownTokens, substitute } from '@shared/substitution'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PRESET_ICON_NAMES } from '@/lib/preset-icons'
import { PresetIcon } from '@/components/preset-icon'
import { invoke } from '@/api/client'

const SAMPLE = {
  path: '/Users/iso/code/feature-ABC-123',
  branch: 'feature/ABC-123',
  commitHash: '46862b9',
  repoName: 'arborist',
  repoPath: '/Users/iso/code/arborist'
}

function commandValue(command: PresetCommand): string {
  switch (command.type) {
    case 'app':
      return command.app
    case 'url':
      return command.url
    case 'shell':
      return command.script
  }
}

function withValue(type: PresetCommand['type'], value: string): PresetCommand {
  switch (type) {
    case 'app':
      return { type, app: value }
    case 'url':
      return { type, url: value }
    case 'shell':
      return { type, script: value }
  }
}

/**
 * Editing one preset. Shell and URL commands preview against a sample
 * worktree, escaping included, because that is the only way to see what a
 * `{{token}}` will actually become before running it in anger.
 */
export function PresetEditor({
  preset,
  onSave,
  onCancel
}: {
  preset: Preset
  onSave: (preset: Preset) => void
  onCancel: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(preset)
  const value = commandValue(draft.command)
  const unknown = findUnknownTokens(value)

  const preview =
    draft.command.type === 'shell'
      ? substitute(value, SAMPLE, window.arborist.platform === 'win32' ? 'powershell' : 'posix')
      : draft.command.type === 'url'
        ? substitute(value, SAMPLE, 'url')
        : null

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent data-testid="preset-editor" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{preset.name ? 'Edit preset' : 'New preset'}</DialogTitle>
          <DialogDescription>
            Presets appear as buttons under Open In, on every worktree.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="preset-name">Name</Label>
          <Input
            id="preset-name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="preset-icon">Icon</Label>
            {/* The trigger renders the selected item's own content, icon
                included, so it must not repeat the icon itself. */}
            <Select value={draft.icon} onValueChange={(icon) => setDraft({ ...draft, icon })}>
              <SelectTrigger id="preset-icon" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_ICON_NAMES.map((name) => (
                  <SelectItem key={name} value={name}>
                    <PresetIcon name={name} className="size-4" />
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="preset-type">Opens</Label>
            <Select
              value={draft.command.type}
              onValueChange={(type) =>
                setDraft({ ...draft, command: withValue(type as PresetCommand['type'], '') })
              }
            >
              <SelectTrigger id="preset-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="app">An application</SelectItem>
                <SelectItem value="shell">A shell command</SelectItem>
                <SelectItem value="url">A URL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="preset-command">
            {draft.command.type === 'app'
              ? 'Application'
              : draft.command.type === 'url'
                ? 'URL template'
                : 'Command'}
          </Label>
          {draft.command.type === 'shell' ? (
            <Textarea
              id="preset-command"
              className="min-h-20 font-mono text-xs"
              spellCheck={false}
              placeholder="code {{path}}"
              value={value}
              onChange={(event) =>
                setDraft({ ...draft, command: withValue('shell', event.target.value) })
              }
            />
          ) : (
            <div className="flex gap-2">
              <Input
                id="preset-command"
                className="font-mono text-xs"
                spellCheck={false}
                placeholder={
                  draft.command.type === 'app'
                    ? '/Applications/Sublime Text.app'
                    : 'https://example.com/branch/{{branch}}'
                }
                value={value}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    command: withValue(draft.command.type as 'app' | 'url', event.target.value)
                  })
                }
              />
              {draft.command.type === 'app' && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const chosen = await invoke('system:pickApplication')
                    if (chosen) setDraft({ ...draft, command: withValue('app', chosen) })
                  }}
                >
                  Choose…
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Tokens:{' '}
            <span className="font-mono">
              {'{{path}} {{branch}} {{commitHash}} {{repoName}} {{repoPath}}'}
            </span>
          </p>
        </div>

        {preview && (
          <div className="rounded-md border p-3" data-testid="preset-preview">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            <p className="mt-1 font-mono text-[11px] break-all">{preview}</p>
          </div>
        )}

        {unknown.length > 0 && (
          <p className="text-xs text-amber-500">
            Unknown token{unknown.length > 1 ? 's' : ''}: {unknown.join(', ')}. They will be left as
            written.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!draft.name.trim() || !value.trim()}
            onClick={() => onSave({ ...draft, name: draft.name.trim() })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
