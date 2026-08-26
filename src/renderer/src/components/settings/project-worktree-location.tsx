import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { resolveWorktreeLocation } from '@shared/worktree-location'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { CopyableError } from '@/components/copyable-error'
import { queryKeys, useProjectSettings, useProjects, useSettings } from '@/api/queries'
import { invoke } from '@/api/client'
import { rootConflictsWithProject } from '@/lib/worktree-location'

type LocationOverride = 'inherit' | 'beside' | 'central'

/**
 * Per-project worktree-location override, as a tri-state over the app-level
 * setting. Inherit says what it currently resolves to, so the effect of
 * leaving it alone is visible rather than a join the reader has to do in
 * their head — the same convention `ProjectPresetOverrides` uses.
 */
export function ProjectWorktreeLocation({ projectId }: { projectId: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const settings = useSettings()
  const projectSettings = useProjectSettings(projectId)
  const projects = useProjects()
  const [error, setError] = useState<string | null>(null)

  if (!settings.data) return <></>

  const appResolved = resolveWorktreeLocation(settings.data, undefined)
  const inheritLabel =
    appResolved.mode === 'central'
      ? `Inherit (Central: ${appResolved.root ?? 'not set'})`
      : 'Inherit (Beside the repository)'

  const override = (projectSettings.data?.worktreeLocation ?? 'inherit') as LocationOverride
  const root = projectSettings.data?.worktreeRoot ?? null

  const set = async (
    changes: Partial<{
      worktreeLocation: 'beside' | 'central' | undefined
      worktreeRoot: string | null
    }>
  ): Promise<void> => {
    await invoke('projectSettings:set', projectId, changes)
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectSettings(projectId) })
  }

  return (
    <section className="space-y-2" data-testid="project-worktree-location">
      <Label htmlFor="project-worktree-location">Worktree location</Label>
      <Select
        value={override}
        onValueChange={(value) => {
          const next = value as LocationOverride
          void set({ worktreeLocation: next === 'inherit' ? undefined : next })
        }}
      >
        <SelectTrigger id="project-worktree-location" className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">{inheritLabel}</SelectItem>
          <SelectItem value="beside">Beside the repository</SelectItem>
          <SelectItem value="central">In a central directory</SelectItem>
        </SelectContent>
      </Select>

      {override === 'central' && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const picked = await invoke('system:pickFolder')
              if (!picked) return
              const projectPaths = (projects.data ?? []).map((project) => project.path)
              if (rootConflictsWithProject(picked, projectPaths)) {
                setError(
                  'That folder is inside a project already in Arborist, so worktrees for every other project would show up as changes there.'
                )
                return
              }
              setError(null)
              await set({ worktreeRoot: picked })
            }}
          >
            Choose…
          </Button>
          <p className="flex-1 truncate font-mono text-xs text-muted-foreground">
            {root ?? 'No directory chosen'}
          </p>
        </div>
      )}
      {error && <CopyableError className="text-xs" message={error} />}
    </section>
  )
}
