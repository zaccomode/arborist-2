import { CircleAlert, GitBranch, Hash, House, MoreVertical, RefreshCw } from 'lucide-react'
import type { Worktree } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { syncSummary, worktreeTitle } from '@shared/format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Chip } from '@/components/chip'
import { NotesEditor } from '@/components/notes-editor'
import { OpenInGrid } from '@/components/open-in-grid'
import { RecentCommits } from '@/components/recent-commits'
import { invoke } from '@/api/client'

export function WorktreeDetail({
  worktree,
  project,
  onRefresh,
  refreshing,
  onDelete,
  onRunSetup
}: {
  worktree: Worktree
  project: Repository
  onRefresh: () => void
  refreshing: boolean
  onDelete: () => void
  onRunSetup: () => void
}): React.JSX.Element {
  const hash = worktree.status?.lastCommit?.shortHash ?? worktree.head?.slice(0, 7) ?? null

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6" data-testid="worktree-detail">
      <div className="flex items-start gap-3">
        {worktree.isMain ? (
          <House className="mt-1.5 size-6 shrink-0 text-muted-foreground" />
        ) : (
          <GitBranch className="mt-1.5 size-6 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{worktreeTitle(worktree)}</h1>
          <button
            type="button"
            title="Copy path"
            onClick={() => void invoke('system:copyText', worktree.path)}
            className="block max-w-full truncate font-mono text-sm text-muted-foreground hover:text-foreground"
          >
            {worktree.path}
          </button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Worktree actions">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={worktree.prunable} onSelect={onRunSetup}>
              Run setup
            </DropdownMenuItem>
            {/* The repository's own worktree cannot be removed, so the action
                is absent rather than present and failing. */}
            {worktree.isMain ? (
              <DropdownMenuItem disabled>The main worktree cannot be deleted</DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="destructive"
                disabled={worktree.locked}
                title={worktree.locked ? 'Unlock this worktree before deleting it' : undefined}
                onSelect={onDelete}
              >
                Delete worktree…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {worktree.prunable && (
        <div
          data-testid="prunable-banner"
          className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm"
        >
          <CircleAlert className="size-4 shrink-0 text-destructive" />
          <span className="flex-1">
            This worktree&apos;s folder is gone. Git still lists it until the entry is pruned.
          </span>
          <Button size="sm" variant="outline" onClick={onDelete}>
            Remove entry
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {hash && (
          <Chip
            title="Copy commit hash"
            onClick={() =>
              void invoke('system:copyText', worktree.status?.lastCommit?.hash ?? hash)
            }
          >
            <Hash className="size-3" />
            {hash}
          </Chip>
        )}
        <Chip>{syncSummary(worktree)}</Chip>
        {worktree.status?.dirty && <Chip>Uncommitted changes</Chip>}
        {worktree.locked && (
          <Chip>{worktree.lockReason ? `Locked: ${worktree.lockReason}` : 'Locked'}</Chip>
        )}
      </div>

      <OpenInGrid project={project} worktree={worktree} />

      <RecentCommits
        key={`commits:${project.id}:${worktree.path}`}
        repoPath={project.path}
        gitRef={worktree.branch ?? worktree.head}
      />

      <NotesEditor
        key={`notes:${project.id}:${worktree.path}`}
        repositoryId={project.id}
        worktreePath={worktree.path}
      />

      {worktree.statusError && (
        <p className="mt-2 text-xs text-destructive">{worktree.statusError}</p>
      )}
    </div>
  )
}
