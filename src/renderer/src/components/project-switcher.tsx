import { ChevronDown, FolderGit2, FolderPlus } from 'lucide-react'
import type { Repository } from '@shared/persisted'
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
 * room for a worktree's detail, so the switcher carries the project list.
 */
export function ProjectSwitcher({
  projects,
  selectedId,
  onSelect,
  onAddProject
}: {
  projects: Repository[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAddProject: () => void
}): React.JSX.Element {
  const selected = projects.find((project) => project.id === selectedId)

  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
