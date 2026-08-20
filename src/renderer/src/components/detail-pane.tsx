import { useState } from 'react'
import { FolderGit2, MoreVertical, TreePine } from 'lucide-react'
import type { Repository } from '@shared/persisted'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

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
 * Shown when no worktree is selected. Project-scoped actions live in the
 * overflow menu here rather than in the sidebar, which is what lets the
 * sidebar stay a list of worktrees and nothing else.
 */
export function ProjectDetail({
  project,
  onRemove
}: {
  project: Repository
  onRemove: () => void
}): React.JSX.Element {
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  return (
    <div className="flex h-full flex-col p-6" data-testid="project-detail">
      <div className="flex items-start gap-3">
        <FolderGit2 className="mt-1.5 size-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{project.name}</h1>
          <p className="truncate font-mono text-sm text-muted-foreground">{project.path}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Project actions">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingRemove(true)}>
              Remove project…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {project.name} from Arborist?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the project from Arborist. The repository, its worktrees and its
              branches are left exactly as they are on disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onRemove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
