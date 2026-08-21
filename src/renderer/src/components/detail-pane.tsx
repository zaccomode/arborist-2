import { GitBranch, TreePine } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function NoProjects({ onAddProject }: { onAddProject: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center" data-testid="no-projects">
      <TreePine className="size-10 text-muted-foreground" />
      <h1 className="mt-4 text-2xl font-semibold">Arborist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a git repository to see and manage its worktrees.
      </p>
      <Button className="mt-6" onClick={onAddProject}>
        Add project…
      </Button>
    </div>
  )
}

/**
 * A project is open but no worktree is chosen. The pane says so and offers
 * the one action worth taking from here; project-scoped settings and actions
 * live in the sidebar and the project switcher, where the project itself is.
 */
export function NoWorktreeSelected({
  onNewWorktree
}: {
  onNewWorktree: () => void
}): React.JSX.Element {
  return (
    <div
      className="flex h-full flex-col items-center justify-center"
      data-testid="no-worktree-selected"
    >
      <GitBranch className="size-10 text-muted-foreground" />
      <h1 className="mt-4 text-lg font-semibold">No worktree selected</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick one from the list, or start a new one.
      </p>
      <Button variant="outline" className="mt-6" onClick={onNewWorktree}>
        New worktree…
      </Button>
    </div>
  )
}
