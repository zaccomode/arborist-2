import { CircleAlert, GitBranch, Hash, House, MoreVertical, RefreshCw } from 'lucide-react'
import type { Worktree } from '@shared/domain'
import { syncSummary, worktreeTitle } from '@shared/format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { NotesEditor } from '@/components/notes-editor'
import { invoke } from '@/api/client'

function Chip({
  children,
  onClick,
  title
}: {
  children: React.ReactNode
  onClick?: () => void
  title?: string
}): React.JSX.Element {
  const className =
    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground'
  if (!onClick) return <span className={className}>{children}</span>
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`${className} hover:bg-accent`}
    >
      {children}
    </button>
  )
}

export function WorktreeDetail({
  worktree,
  repositoryId,
  onRefresh,
  refreshing,
  actions
}: {
  worktree: Worktree
  repositoryId: string
  onRefresh: () => void
  refreshing: boolean
  /** Overflow-menu entries the surrounding screen owns, such as deletion. */
  actions?: React.ReactNode
}): React.JSX.Element {
  const hash = worktree.status?.lastCommit?.shortHash ?? worktree.head?.slice(0, 7) ?? null

  return (
    <div className="flex h-full flex-col p-6" data-testid="worktree-detail">
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
        {actions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Worktree actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{actions}</DropdownMenuContent>
          </DropdownMenu>
        )}
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

      <NotesEditor
        key={`${repositoryId}:${worktree.path}`}
        repositoryId={repositoryId}
        worktreePath={worktree.path}
      />

      {worktree.statusError && (
        <p className="mt-2 text-xs text-destructive">{worktree.statusError}</p>
      )}
    </div>
  )
}
