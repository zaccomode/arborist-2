import { useState } from 'react'
import { ChevronDown, FolderGit2, FolderPlus, Settings, SlidersHorizontal } from 'lucide-react'
import type { Repository } from '@shared/persisted'
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * One project at a time, chosen here. v1 listed every repository in the
 * sidebar at once; the concept design trades that overview for a view with
 * room for a worktree's detail, so the switcher carries the project list —
 * and, with it, the actions that belong to a project rather than a worktree.
 */
export function ProjectSwitcher({
  projects,
  selectedId,
  onSelect,
  onAddProject,
  onOpenSettings,
  onOpenProjectSettings,
  onPrune,
  onRemoveProject
}: {
  projects: Repository[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAddProject: () => void
  onOpenSettings: () => void
  onOpenProjectSettings: () => void
  onPrune: () => void
  onRemoveProject: () => void
}): React.JSX.Element {
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const selected = projects.find((project) => project.id === selectedId)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-2 rounded-lg border bg-sidebar px-3 py-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-testid="project-switcher"
        >
          <FolderGit2 className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-left">{selected?.name ?? 'No project'}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          {projects.length > 0 && (
            <>
              <DropdownMenuRadioGroup value={selectedId ?? ''} onValueChange={onSelect}>
                {projects.map((project) => (
                  <DropdownMenuRadioItem key={project.id} value={project.id}>
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={onAddProject}>
            <FolderPlus />
            Add project…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenSettings}>
            <Settings />
            App settings…
          </DropdownMenuItem>

          {selected && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenProjectSettings}>
                <SlidersHorizontal />
                Project settings…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onPrune}>Prune missing worktrees</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingRemove(true)}>
                Remove project…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent data-testid="remove-project-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selected?.name} from Arborist?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the project from Arborist. The repository, its worktrees and its
              branches are left exactly as they are on disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onRemoveProject}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
