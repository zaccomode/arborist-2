import { useState } from 'react'
import { CircleAlert, GitBranch, Hash, House, MoreVertical, RefreshCw } from 'lucide-react'
import type { Worktree, WorktreeTab } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { syncSummary, worktreeTitle } from '@shared/format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Chip } from '@/components/chip'
import { CommitGraph } from '@/components/commit-graph'
import { CopyableError } from '@/components/copyable-error'
import { NotesEditor } from '@/components/notes-editor'
import { OpenInGrid } from '@/components/open-in-grid'
import { SwitchBranchDialog } from '@/components/switch-branch-dialog'
import { SyncActions } from '@/components/sync-actions'
import { WorkingTreeTab } from '@/components/working-tree-tab'
import { invoke } from '@/api/client'
import { useWorktreeTab } from '@/state/selection'

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
  const [tab, setTab] = useWorktreeTab(project.id, worktree.path)
  const [switchOpen, setSwitchOpen] = useState(false)
  // Bumped rather than a plain boolean, so a second "Commit first" while the
  // Working Tree tab is already open still refocuses the box — a boolean
  // that was already true wouldn't re-trigger the effect that reads it.
  const [focusCommitToken, setFocusCommitToken] = useState(0)

  const handleCommitFirst = (): void => {
    setTab('working-tree')
    setFocusCommitToken((token) => token + 1)
  }

  return (
    <div className="flex h-full flex-col" data-testid="worktree-detail">
      <div className="shrink-0 p-6 pb-0">
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
          <SyncActions repoPath={project.path} worktree={worktree} />
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
              <DropdownMenuItem disabled={worktree.prunable} onSelect={() => setSwitchOpen(true)}>
                Switch branch…
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

        {worktree.statusError && (
          <CopyableError className="mt-2 text-xs" message={worktree.statusError} />
        )}
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as WorktreeTab)}
        className="mt-4 flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 border-b">
          <TabsList variant="line" className="mx-6 w-fit">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="working-tree">Working Tree</TabsTrigger>
            <TabsTrigger value="commit-graph">Commit Graph</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <OpenInGrid project={project} worktree={worktree} />

          <NotesEditor
            key={`notes:${project.id}:${worktree.path}`}
            repositoryId={project.id}
            worktreePath={worktree.path}
          />
        </TabsContent>

        {/* Unlike the other two tabs, this one manages its own scrolling: the
            commit box pins to the bottom of the panel instead of scrolling
            away with the file list (#66), so the padding and scroll region
            live inside `WorkingTreeTab` rather than out here. */}
        <TabsContent value="working-tree" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <WorkingTreeTab
            repositoryId={project.id}
            repoPath={project.path}
            repoName={project.name}
            worktree={worktree}
            focusCommitToken={focusCommitToken}
          />
        </TabsContent>

        <TabsContent value="commit-graph" className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <CommitGraph
            key={`commit-graph:${project.id}:${worktree.path}`}
            repositoryId={project.id}
            repoPath={project.path}
            worktree={worktree}
          />
        </TabsContent>
      </Tabs>

      <SwitchBranchDialog
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        repoPath={project.path}
        projectId={project.id}
        worktree={worktree}
        onCommitFirst={handleCommitFirst}
      />
    </div>
  )
}
