import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import type { Preset } from '@shared/persisted'
import { builtInPresetId, filterForTarget, resolveConflictEditorPreset } from '@shared/presets'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { PresetIcon } from '@/components/preset-icon'
import { queryKeys, usePresetCatalogue, usePresets, useSettings } from '@/api/queries'
import { invoke } from '@/api/client'
import { PresetEditor } from '@/components/settings/preset-editor'

function newPreset(): Preset {
  return {
    id: crypto.randomUUID(),
    name: '',
    icon: 'SquareTerminal',
    command: { type: 'shell', script: '' },
    sortOrder: 0,
    enabledByDefault: true,
    projectId: null
  }
}

/**
 * App-level presets. Built-ins can be switched on and off and nothing else,
 * which the UI shows by offering nothing else; custom ones can be created,
 * edited, reordered and deleted. v1 had the reordering code and never wired a
 * control to it, so it silently did not exist.
 */
export function PresetSettings(): React.JSX.Element {
  const queryClient = useQueryClient()
  const catalogue = usePresetCatalogue()
  const settings = useSettings()
  // App-level, no project: the same list a project inherits from when it has
  // no override of its own.
  const appPresets = usePresets(null, null)
  const [editing, setEditing] = useState<Preset | null>(null)

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['presets'] })
    await queryClient.invalidateQueries({ queryKey: ['preset-catalogue'] })
  }

  const filePresets = filterForTarget(appPresets.data ?? [], 'file')

  const setConflictEditor = async (value: string): Promise<void> => {
    await invoke('settings:update', {
      conflictEditorPresetId: value === 'auto' ? null : value
    })
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
  }

  const builtIns = catalogue.data?.builtIns ?? []
  const custom = catalogue.data?.presets.filter((preset) => preset.projectId === null) ?? []
  const order = catalogue.data?.config.order ?? []

  const ordered = [...custom].sort((a, b) => {
    const rank = (id: string): number => {
      const index = order.indexOf(id)
      return index === -1 ? Number.MAX_SAFE_INTEGER : index
    }
    return rank(a.id) - rank(b.id) || a.sortOrder - b.sortOrder
  })

  const move = async (index: number, delta: number): Promise<void> => {
    const ids = ordered.map((preset) => preset.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    await invoke('presets:reorder', [...builtIns.map((preset) => preset.id), ...ids])
    await refresh()
  }

  return (
    <div className="space-y-6 py-2" data-testid="preset-settings">
      {settings.data && filePresets.length > 0 && (
        <section className="space-y-2" data-testid="conflict-editor-setting">
          <Label htmlFor="conflict-editor-preset">Conflict editor</Label>
          <p className="text-xs text-muted-foreground">
            Which preset &quot;Open in editor&quot; runs for a conflicted file. A project can
            override this.
          </p>
          <Select
            value={settings.data.conflictEditorPresetId ?? 'auto'}
            onValueChange={(value) => void setConflictEditor(value)}
          >
            <SelectTrigger id="conflict-editor-preset" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                Automatic ({resolveConflictEditorPreset(null, filePresets)?.name ?? 'none'})
              </SelectItem>
              {filePresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>
      )}

      <section>
        <p className="text-xs font-medium text-muted-foreground">Built in</p>
        <ul className="mt-2 space-y-1">
          {builtIns.map((preset) => {
            return (
              <li key={preset.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <PresetIcon name={preset.icon} className="size-4 text-muted-foreground" />
                <span className="flex-1 text-sm">{preset.name}</span>
                <Switch
                  checked={preset.enabled}
                  aria-label={preset.name}
                  onCheckedChange={async (enabled) => {
                    await invoke('presets:setEnabled', builtInPresetId(preset.builtinId), enabled)
                    await refresh()
                  }}
                />
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Your presets</p>
          <Button size="sm" variant="outline" onClick={() => setEditing(newPreset())}>
            New preset
          </Button>
        </div>

        {ordered.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            None yet. A preset can open an app, run a shell command, or follow a URL.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {ordered.map((preset, index) => {
              return (
                <li key={preset.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <PresetIcon name={preset.icon} className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm">{preset.name}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move ${preset.name} up`}
                    disabled={index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move ${preset.name} down`}
                    disabled={index === ordered.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Edit ${preset.name}`}
                    onClick={() => setEditing(preset)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Delete ${preset.name}`}
                    onClick={async () => {
                      await invoke('presets:delete', preset.id)
                      await refresh()
                    }}
                  >
                    <Trash2 />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {editing && (
        <PresetEditor
          preset={editing}
          onCancel={() => setEditing(null)}
          onSave={async (preset) => {
            await invoke('presets:save', preset)
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </div>
  )
}
