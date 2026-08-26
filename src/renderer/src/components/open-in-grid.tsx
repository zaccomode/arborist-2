import { useState } from 'react'
import type { Worktree } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { PresetIcon } from '@/components/preset-icon'
import { PresetConsole, type PresetRun } from '@/components/preset-console'
import { Button } from '@/components/ui/button'
import { usePresets } from '@/api/queries'
import { invoke } from '@/api/client'
import { showErrorToast } from '@/lib/error-toast'

/**
 * The macro buttons from the concept design: icon over label, wrapping to
 * further rows. Every preset switched on for this project is here whether or
 * not the app behind it is installed — pressing one and being told what went
 * wrong beats a button that quietly never appears.
 */
export function OpenInGrid({
  project,
  worktree
}: {
  project: Repository
  worktree: Worktree
}): React.JSX.Element | null {
  const presets = usePresets(project.path, project.id)
  const [consoleRun, setConsoleRun] = useState<PresetRun | null>(null)
  const list = presets.data ?? []

  if (list.length === 0) return null

  const run = async (presetId: string): Promise<void> => {
    try {
      const result = await invoke('presets:run', presetId, {
        path: worktree.path,
        branch: worktree.branch,
        commitHash: worktree.status?.lastCommit?.hash ?? worktree.head,
        repoName: project.name,
        repoPath: project.path,
        filePath: null,
        fileLine: null,
        projectId: project.id
      })
      // A shell preset runs somewhere the user can watch it; everything else
      // has handed off to another application and has nothing more to show.
      if (result.kind === 'console') setConsoleRun(result)
    } catch (error) {
      showErrorToast('Could not open', { description: (error as Error).message })
    }
  }

  return (
    <section className="mt-5" data-testid="open-in-grid">
      <p className="text-xs font-medium text-muted-foreground">Open In</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {list.map((preset) => {
          return (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              // A prunable worktree's directory is gone, so there is nothing
              // for any of these to open.
              disabled={worktree.prunable}
              onClick={() => void run(preset.id)}
              className="h-[76px] max-w-[220px] min-w-[120px] flex-1 flex-col gap-2 rounded-lg"
            >
              <PresetIcon name={preset.icon} className="size-5 text-muted-foreground" />
              {preset.name}
            </Button>
          )
        })}
      </div>

      <PresetConsole run={consoleRun} onClose={() => setConsoleRun(null)} />
    </section>
  )
}
