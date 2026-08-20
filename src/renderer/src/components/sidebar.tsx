import { Plus } from 'lucide-react'
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
  addError,
  children
}: {
  projects: Repository[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAddProject: () => void
  onNewWorktree: () => void
  onOpenSettings: () => void
  /** Why the last add failed, shown where the user asked for it. */
  addError: string | null
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-2 pr-1">
      <ProjectSwitcher
        projects={projects}
        selectedId={selectedId}
        onSelect={onSelect}
        onAddProject={onAddProject}
        onOpenSettings={onOpenSettings}
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
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{children}</div>
      </aside>
    </div>
  )
}
