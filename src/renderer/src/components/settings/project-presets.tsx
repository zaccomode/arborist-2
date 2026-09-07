import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import type { Preset } from '@shared/persisted'
import { Button } from '@/components/ui/button'
import { PresetIcon } from '@/components/preset-icon'
import { usePresetCatalogue } from '@/api/queries'
import { invoke } from '@/api/client'
import { PresetEditor } from '@/components/settings/preset-editor'

function newPreset(projectId: string): Preset {
  return {
    id: crypto.randomUUID(),
    name: '',
    icon: 'SquareTerminal',
    command: { type: 'shell', script: '' },
    sortOrder: 0,
    enabledByDefault: true,
    projectId
  }
}

/**
 * Presets that belong to this project alone, on top of whichever app-level
 * ones are switched on for it. Ordered by their own `sortOrder` rather than
 * the app-level reorder list: project presets sit outside it entirely, so
 * reordering them here can't disturb another project's order.
 */
export function ProjectPresets({ projectId }: { projectId: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const catalogue = usePresetCatalogue()
  const [editing, setEditing] = useState<Preset | null>(null)

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['presets'] })
    await queryClient.invalidateQueries({ queryKey: ['preset-catalogue'] })
  }

  const ordered = (catalogue.data?.presets ?? [])
    .filter((preset) => preset.projectId === projectId)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const move = async (index: number, delta: number): Promise<void> => {
    const target = index + delta
    if (target < 0 || target >= ordered.length) return
    const a = ordered[index]
    const b = ordered[target]
    await invoke('presets:save', { ...a, sortOrder: b.sortOrder })
    await invoke('presets:save', { ...b, sortOrder: a.sortOrder })
    await refresh()
  }

  return (
    <section data-testid="project-presets">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">This project&apos;s presets</p>
        <Button size="sm" variant="outline" onClick={() => setEditing(newPreset(projectId))}>
          New preset
        </Button>
      </div>

      {ordered.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          None yet. Unlike the presets above, one added here is only ever offered on this project.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {ordered.map((preset, index) => (
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
          ))}
        </ul>
      )}

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
    </section>
  )
}
