import { Brush, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react'
import type { Repository } from '@shared/persisted'
import { Button } from '@/components/ui/button'
import { ProjectSwitcher } from '@/components/project-switcher'

export function Sidebar({
  projects,
  selectedId,
  onSelect,
  onAddProject,
  onNewWorktree,
  onOpenSettings,
  onOpenProjectSettings,
  onPrune,
  prunableCount,
  addError,
  onFetch,
  fetching,
  remoteBranches,
  children
}: {
  projects: Repository[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAddProject: () => void
  onNewWorktree: () => void
  onOpenSettings: () => void
  onOpenProjectSettings: () => void
  onPrune: () => void
  /** How many worktrees git still lists whose folder has gone. */
  prunableCount: number
  /** Why the last add failed, shown where the user asked for it. */
  addError: string | null
  onFetch: () => void
  fetching: boolean
  /** The Remote Branches section body, rendered under its own header. */
  remoteBranches?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-2">
      <ProjectSwitcher
        projects={projects}
        selectedId={selectedId}
        onSelect={onSelect}
        onAddProject={onAddProject}
        onOpenSettings={onOpenSettings}
        onFetch={onFetch}
        fetching={fetching}
      />

      {addError && (
        <p data-testid="add-project-error" className="px-1 text-xs text-destructive">
          {addError}
        </p>
      )}

      <aside className="flex min-h-0 flex-1 flex-col rounded-lg border bg-sidebar">
        <div className="flex items-center justify-between py-2 pr-2 pl-3">
          <p className="text-xs font-medium text-muted-foreground">Worktrees</p>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New worktree"
            disabled={!selectedId}
            onClick={onNewWorktree}
          >
            <Plus />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {children}

          {/* Under the rows it is about, and only when there is something to
              prune. Pruning is a reaction to what the list is showing, not a
              standing menu item nobody needs most days. */}
          {prunableCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="prune-worktrees"
              className="mt-1 w-full justify-start font-normal text-muted-foreground"
              onClick={onPrune}
            >
              <Brush />
              Prune {prunableCount} missing worktree{prunableCount > 1 ? 's' : ''}
            </Button>
          )}

          {/* Directly below the worktrees rather than its own scrolling
              slice, so the two lists move together. */}
          <div className="mt-4 flex items-center justify-between py-2 pl-1">
            <p className="text-xs font-medium text-muted-foreground">Remote Branches</p>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Fetch remotes"
              disabled={!selectedId || fetching}
              onClick={onFetch}
            >
              <RefreshCw className={fetching ? 'animate-spin' : undefined} />
            </Button>
          </div>
          {remoteBranches}
        </div>

        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal text-muted-foreground"
            disabled={!selectedId}
            onClick={onOpenProjectSettings}
          >
            <SlidersHorizontal />
            Project settings
          </Button>
        </div>
      </aside>
    </div>
  )
}
