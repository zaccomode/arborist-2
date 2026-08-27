import { useQueryClient } from '@tanstack/react-query'
import { filterForTarget, resolveConflictEditorPreset } from '@shared/presets'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { queryKeys, usePresets, useProjectSettings, useSettings } from '@/api/queries'
import { invoke } from '@/api/client'

/**
 * Per-project default for the Conflicts section's "Open in editor", as a
 * tri-state over the app-level setting — the same inherit-shows-the-
 * effective-value convention `ProjectWorktreeLocation` uses, so leaving this
 * alone shows what it currently resolves to rather than a join the reader
 * has to do in their head. Only file-capable presets are offered — see
 * `filterForTarget`.
 */
export function ProjectConflictEditor({ projectId }: { projectId: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const settings = useSettings()
  const projectSettings = useProjectSettings(projectId)
  const presets = usePresets(null, projectId)

  if (!settings.data) return <></>

  const filePresets = filterForTarget(presets.data ?? [], 'file')
  if (filePresets.length === 0) return <></>

  const appDefault = resolveConflictEditorPreset(settings.data.conflictEditorPresetId, filePresets)
  const inheritLabel = appDefault ? `Inherit (${appDefault.name})` : 'Inherit (none available)'
  const override = projectSettings.data?.conflictEditorPresetId ?? 'inherit'

  const set = async (value: string): Promise<void> => {
    await invoke('projectSettings:set', projectId, {
      conflictEditorPresetId: value === 'inherit' ? undefined : value
    })
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectSettings(projectId) })
  }

  return (
    <section className="space-y-2" data-testid="project-conflict-editor">
      <Label htmlFor="project-conflict-editor">Conflict editor</Label>
      <p className="text-xs text-muted-foreground">
        Which preset &quot;Open in editor&quot; runs for a conflicted file in this project.
      </p>
      <Select value={override ?? 'inherit'} onValueChange={(value) => void set(value)}>
        <SelectTrigger id="project-conflict-editor" className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">{inheritLabel}</SelectItem>
          {filePresets.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  )
}
