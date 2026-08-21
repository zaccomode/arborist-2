import { useState } from 'react'
import { toast } from 'sonner'
import type { Worktree } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { PresetIcon } from '@/components/preset-icon'
import { PresetConsole, type PresetRun } from '@/components/preset-console'
import { usePresets } from '@/api/queries'
import { invoke } from '@/api/client'

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
        projectId: project.id
      })
      // A shell preset runs somewhere the user can watch it; everything else
      // has handed off to another application and has nothing more to show.
      if (result.kind === 'console') setConsoleRun(result)
    } catch (error) {
      toast.error('Could not open', { description: (error as Error).message })
    }
  }

  return (
    <section className="mt-5" data-testid="open-in-grid">
      <p className="text-xs font-medium text-muted-foreground">Open In</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {list.map((preset) => {
          return (
            <button
              key={preset.id}
              type="button"
              // A prunable worktree's directory is gone, so there is nothing
              // for any of these to open.
              disabled={worktree.prunable}
              onClick={() => void run(preset.id)}
              className="flex h-[76px] max-w-[220px] min-w-[120px] flex-1 flex-col items-center justify-center gap-2 rounded-lg border bg-sidebar text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <PresetIcon name={preset.icon} className="size-5 text-muted-foreground" />
              {preset.name}
            </button>
          )
        })}
      </div>

      <PresetConsole run={consoleRun} onClose={() => setConsoleRun(null)} />
    </section>
  )
}
