import { toast } from 'sonner'
import type { Worktree } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { PresetIcon } from '@/components/preset-icon'
import { usePresets } from '@/api/queries'
import { invoke } from '@/api/client'

/**
 * The macro buttons from the concept design: icon over label, wrapping to
 * further rows. What appears here is whatever the presets resolved to for
 * this project on this machine, so a missing editor is simply absent.
 */
export function OpenInGrid({
  project,
  worktree
}: {
  project: Repository
  worktree: Worktree
}): React.JSX.Element | null {
  const presets = usePresets(project.path, project.id)
  const list = presets.data ?? []

  if (list.length === 0) return null

  const run = async (presetId: string): Promise<void> => {
    try {
      await invoke('presets:run', presetId, {
        path: worktree.path,
        branch: worktree.branch,
        commitHash: worktree.status?.lastCommit?.hash ?? worktree.head,
        repoName: project.name,
        repoPath: project.path,
        projectId: project.id
      })
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
    </section>
  )
}
