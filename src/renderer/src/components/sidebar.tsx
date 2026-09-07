import { Brush, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react'
import type { Repository } from '@shared/persisted'
import { Button } from '@/components/ui/button'
import { CopyableError } from '@/components/copyable-error'
import { IconButton } from '@/components/icon-button'
import { ListControls, ListSearchField, type ListViewControls } from '@/components/list-controls'
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
  worktreeView,
  remoteBranchView,
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
  /** Sort and search for each list — see `ListViewControls`. */
  worktreeView: ListViewControls
  remoteBranchView: ListViewControls
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
        <CopyableError testId="add-project-error" className="px-1 text-xs" message={addError} />
      )}

      {/* `overflow-hidden` so the scroll container inside — and the sticky
          heading pinned at its top — are clipped to this panel's own rounded
          corners rather than painting square ones over them. */}
      <aside className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-sidebar">
        {/* Both headings scroll with the list they head and stick at the top
            of the scroll area on the way past (#80). Two sticky blocks share
            one offset, so as the Remote Branches heading arrives it comes to
            rest over the Worktrees one and takes its place — the higher `z`
            decides which is on top, and the opaque background is what makes
            that read as a replacement rather than as two headings printed
            over each other. Each heading carries its own search field, so a
            field cannot scroll out from under the heading it belongs to. */}
        <div data-testid="sidebar-scroll" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div className="sticky top-0 z-10 bg-sidebar">
            <div className="flex items-center justify-between gap-1 py-2 pl-1">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                Worktrees
              </p>
              <ListControls label="Worktrees" view={worktreeView} disabled={!selectedId} />
              <IconButton
                variant="ghost"
                size="icon-xs"
                label="New worktree"
                disabled={!selectedId}
                onClick={onNewWorktree}
              >
                <Plus />
              </IconButton>
            </div>
            {worktreeView.search.open && (
              <ListSearchField label="Worktrees" search={worktreeView.search} />
            )}
          </div>
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
          <div className="sticky top-0 z-20 mt-4 bg-sidebar">
            <div className="flex items-center justify-between gap-1 py-2 pl-1">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                Remote Branches
              </p>
              <ListControls
                label="Remote Branches"
                view={remoteBranchView}
                disabled={!selectedId}
              />
              <IconButton
                variant="ghost"
                size="icon-xs"
                label="Fetch remotes"
                disabled={!selectedId || fetching}
                onClick={onFetch}
              >
                <RefreshCw className={fetching ? 'animate-spin' : undefined} />
              </IconButton>
            </div>
            {remoteBranchView.search.open && (
              <ListSearchField label="Remote Branches" search={remoteBranchView.search} />
            )}
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
