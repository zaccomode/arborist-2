import { useQueryClient } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PresetIcon } from '@/components/preset-icon'
import { usePresetCatalogue, usePresets } from '@/api/queries'
import { invoke } from '@/api/client'

type Override = 'inherit' | 'on' | 'off'

/**
 * Per-project preset switches, as a tri-state over the app-level setting.
 * Inherit says what it currently resolves to, so the effect of leaving it
 * alone is visible rather than a join the reader has to do in their head.
 */
export function ProjectPresetOverrides({ projectId }: { projectId: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const catalogue = usePresetCatalogue()
  const resolved = usePresets(null, projectId)

  const overrides = catalogue.data?.config.overrides[projectId] ?? {}
  const entries = [
    ...(catalogue.data?.builtIns ?? []).map((preset) => ({
      id: preset.id,
      name: preset.name,
      icon: preset.icon,
      appLevel: preset.enabled
    })),
    ...(catalogue.data?.presets ?? [])
      .filter((preset) => preset.projectId === null)
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        icon: preset.icon,
        appLevel: !(catalogue.data?.config.disabledIds ?? []).includes(preset.id)
      }))
  ]

  if (entries.length === 0) return <></>

  const set = async (presetId: string, value: Override): Promise<void> => {
    await invoke('presets:setOverride', projectId, presetId, value === 'inherit' ? null : value)
    await queryClient.invalidateQueries({ queryKey: ['preset-catalogue'] })
    await queryClient.invalidateQueries({ queryKey: ['presets'] })
  }

  return (
    <section className="space-y-2" data-testid="project-preset-overrides">
      <p className="text-xs font-medium text-muted-foreground">Presets</p>
      <ul className="space-y-1">
        {entries.map((entry) => {
          const override = (overrides[entry.id] ?? 'inherit') as Override
          const shown = (resolved.data ?? []).some((preset) => preset.id === entry.id)

          return (
            <li key={entry.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <PresetIcon name={entry.icon} className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate text-sm">{entry.name}</span>
              <span className="text-xs text-muted-foreground">{shown ? 'shown' : 'hidden'}</span>
              <Select
                value={override}
                onValueChange={(value) => void set(entry.id, value as Override)}
              >
                <SelectTrigger className="w-40" aria-label={`${entry.name} in this project`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit ({entry.appLevel ? 'on' : 'off'})</SelectItem>
                  <SelectItem value="on">Always on</SelectItem>
                  <SelectItem value="off">Always off</SelectItem>
                </SelectContent>
              </Select>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
