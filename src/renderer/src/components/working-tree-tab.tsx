import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ChangedFile, Worktree } from '@shared/domain'
import {
  diffSideFor,
  isInspectable,
  splitDisplayPath,
  stagedFileCount,
  stagePathsFor,
  stagingState,
  statusKind,
  statusLabel,
  type StatusKind
} from '@shared/working-tree'
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
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { CommitBox } from '@/components/commit-box'
import { ConflictSection } from '@/components/conflict-section'
import { CopyableError } from '@/components/copyable-error'
import { FilePathCell } from '@/components/file-path-cell'
import { StashSection } from '@/components/stash-section'
import { invoke } from '@/api/client'
import { queryKeys, useConflictState, useWorkingTree } from '@/api/queries'
import { useWorktreeInspector } from '@/state/selection'

/** Radix's `checked` prop, from the tri-state model `stagingState` computes. */
function checkboxState(state: ReturnType<typeof stagingState>): boolean | 'indeterminate' {
  if (state === 'indeterminate') return 'indeterminate'
  return state === 'checked'
}

// Literal here, not returned from `src/shared`: Tailwind's content scanner
// only covers the renderer root, so a class name built in a shared pure
// function never makes it into the compiled CSS.
const STATUS_COLOR: Record<StatusKind, string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  modified: 'text-amber-600 dark:text-amber-400',
  deleted: 'text-red-600 dark:text-red-400',
  renamed: 'text-blue-600 dark:text-blue-400',
  conflict: 'text-red-600 dark:text-red-400',
  muted: 'text-muted-foreground'
}

function FileRow({
  file,
  selected,
  onSelect,
  onToggleStage,
  onDiscard
}: {
  file: ChangedFile
  selected: boolean
  onSelect: () => void
  onToggleStage: () => void
  onDiscard: () => void
}): React.JSX.Element {
  const inspectable = isInspectable(file)
  const stageable = file.kind !== 'unmerged'

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role={inspectable ? 'button' : undefined}
            tabIndex={inspectable ? 0 : undefined}
            onClick={inspectable ? onSelect : undefined}
            onKeyDown={
              inspectable
                ? (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onSelect()
                  }
                : undefined
            }
            // Overrides name-from-content: without it, the row's accessible
            // name is a jumble of the checkbox's own label and the status
            // badge's text rather than just the path.
            aria-label={inspectable ? file.path : undefined}
            title={inspectable ? undefined : 'Resolve this conflict in your editor'}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
              inspectable ? 'cursor-pointer hover:bg-accent' : ''
            } ${selected ? 'bg-accent' : ''}`}
          >
            <Checkbox
              checked={checkboxState(stagingState(file))}
              disabled={!stageable}
              onCheckedChange={onToggleStage}
              // The row itself opens the diff panel on click — staging one
              // file shouldn't also do that.
              onClick={(event) => event.stopPropagation()}
              aria-label={`${file.path} staging state`}
            />
            <FilePathCell path={file.path} />
            <Badge
              variant="outline"
              className={`ml-auto shrink-0 font-mono text-[11px] ${STATUS_COLOR[statusKind(file)]}`}
            >
              {statusLabel(file)}
            </Badge>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem variant="destructive" onSelect={onDiscard}>
            Discard…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  )
}

/**
 * The staging model settled in v3 Phase 3 (#45), implemented here: checked
 * means "will be in the next commit". Checking a row stages it, unchecking
 * unstages it; a row already indeterminate (staged and unstaged at once)
 * stages the rest rather than unstaging, since the checkbox only ever moves
 * a row *toward* checked or away from it entirely — never partially back.
 */
export function WorkingTreeTab({
  repositoryId,
  repoPath,
  repoName,
  worktree,
  focusCommitToken
}: {
  repositoryId: string
  repoPath: string
  repoName: string
  worktree: Worktree
  /** Bumped by "Commit first" on the switch-branch dialog to focus the commit box. */
  focusCommitToken?: number
}): React.JSX.Element {
  const worktreePath = worktree.path
  const queryClient = useQueryClient()
  const query = useWorkingTree(worktreePath)
  const conflictQuery = useConflictState(worktreePath)
  const data = query.data
  const allFiles = data?.files ?? []
  // Conflicted rows move to the Conflicts section entirely — no checkbox, no
  // diff panel — so Changed Files only ever shows the rest.
  const conflictedFiles = allFiles.filter((file) => file.kind === 'unmerged')
  const files = allFiles.filter((file) => file.kind !== 'unmerged')
  const allStaged = files.length > 0 && files.every((file) => stagingState(file) === 'checked')
  const anyStaged = files.some((file) => stagingState(file) !== 'unchecked')
  const [inspector, openInspector, closeInspector] = useWorktreeInspector(
    repositoryId,
    worktreePath
  )
  const [discarding, setDiscarding] = useState<ChangedFile | null>(null)
  const [discardError, setDiscardError] = useState<string | null>(null)

  useEffect(() => {
    // The file this inspector is showing no longer has any changes — it was
    // committed, discarded, or reverted outside Arborist — so reading-in-
    // progress on stale content isn't worth keeping around.
    if (!data || inspector?.kind !== 'file') return
    if (!data.files.some((file) => file.path === inspector.path)) closeInspector()
  }, [data, inspector, closeInspector])

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(worktreePath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.conflictState(worktreePath) })
  }

  const toggleFile = async (file: ChangedFile): Promise<void> => {
    const paths = stagePathsFor(file)
    if (stagingState(file) === 'checked') {
      await invoke('workingTree:unstage', worktreePath, paths)
    } else {
      await invoke('workingTree:stage', worktreePath, paths)
    }
    invalidate()
  }

  const toggleAll = async (): Promise<void> => {
    // `files` already excludes conflicted rows — they have no checkbox to
    // begin with, so there is nothing here for "select all" to touch.
    if (allStaged) {
      const paths = files.filter((file) => file.index !== '.').flatMap(stagePathsFor)
      if (paths.length > 0) await invoke('workingTree:unstage', worktreePath, paths)
    } else {
      const paths = files.filter((file) => stagingState(file) !== 'checked').flatMap(stagePathsFor)
      if (paths.length > 0) await invoke('workingTree:stage', worktreePath, paths)
    }
    invalidate()
  }

  const discardFile = async (file: ChangedFile): Promise<void> => {
    setDiscardError(null)
    try {
      await invoke('workingTree:discard', worktreePath, {
        tracked: file.kind === 'untracked' ? [] : [file.path],
        untracked: file.kind === 'untracked' ? [file.path] : []
      })
      setDiscarding(null)
      invalidate()
    } catch (cause) {
      setDiscardError((cause as Error).message)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The scrollable region: everything but the commit box, which stays
          pinned to the bottom of the panel regardless of how many files or
          stashes are above it (#66) — matching the sidebar's own worktree
          list, which pins "Project settings" below a scrolling list the
          same way. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
        {query.isPending && (
          <div className="space-y-2">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-8 w-full" />
            ))}
          </div>
        )}

        {!query.isPending && allFiles.length === 0 && (
          <p className="text-sm text-muted-foreground">No changes.</p>
        )}

        {/* Shown whenever there is a `u` record to deal with, or a git
            operation is still in progress after the last one was resolved
            (Continue hasn't run yet) — not gated on the operation alone, since
            a conflicting stash pop leaves `u` records with no operation behind
            them at all (see `ConflictSection`'s doc comment on `conflictState`). */}
        {(conflictedFiles.length > 0 || conflictQuery.data?.operation) && (
          <ConflictSection
            repositoryId={repositoryId}
            repoPath={repoPath}
            repoName={repoName}
            worktree={worktree}
            files={conflictedFiles}
            conflictState={
              conflictQuery.data ?? { operation: null, sourceLabel: null, targetLabel: null }
            }
            onChanged={invalidate}
          />
        )}

        {files.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
              <Checkbox
                checked={allStaged ? true : anyStaged ? 'indeterminate' : false}
                onCheckedChange={() => void toggleAll()}
                aria-label="All changed files"
              />
              Changed Files
            </div>
            <ul data-testid="working-tree-files" className="divide-y">
              {files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  selected={inspector?.kind === 'file' && inspector.path === file.path}
                  onSelect={() =>
                    openInspector({ kind: 'file', path: file.path, side: diffSideFor(file) })
                  }
                  onToggleStage={() => void toggleFile(file)}
                  onDiscard={() => {
                    setDiscardError(null)
                    setDiscarding(file)
                  }}
                />
              ))}
            </ul>
          </div>
        )}

        {query.error && (
          <CopyableError className="mt-2 text-xs" message={(query.error as Error).message} />
        )}

        <StashSection repoPath={repoPath} worktreePath={worktreePath} />
      </div>

      {/* Pinned footer, full-width border and all — the same shape as the
          tab line above and the line above "Project settings" in the
          sidebar, both of which separate a fixed piece of chrome from a
          scrolling region above it. */}
      <div className="shrink-0 border-t p-6 pt-4">
        <CommitBox
          repositoryId={repositoryId}
          repoPath={repoPath}
          worktree={worktree}
          stagedCount={stagedFileCount(files)}
          focusToken={focusCommitToken}
        />
      </div>

      <AlertDialog open={discarding !== null} onOpenChange={(open) => !open && setDiscarding(null)}>
        <AlertDialogContent data-testid="discard-file-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard changes to {discarding ? splitDisplayPath(discarding.path).name : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {discarding?.kind === 'untracked'
                ? 'This deletes the file. This cannot be undone.'
                : 'This discards its uncommitted changes. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {discardError && <CopyableError className="text-sm" message={discardError} />}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (discarding) void discardFile(discarding)
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
