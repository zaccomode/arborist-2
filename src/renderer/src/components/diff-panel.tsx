import { useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { DiffLine, DiffRequest, UnifiedDiff, UnifiedHunk } from '@shared/diff'
import {
  mergeStagingSides,
  stagingSides,
  unifiedDiffStats,
  unifiedStagingState,
  wholeFilePathsFor
} from '@shared/diff'
import { AppError } from '@shared/errors'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyableError } from '@/components/copyable-error'
import { invoke } from '@/api/client'
import { queryKeys, useFileDiff } from '@/api/queries'
import { showErrorToast } from '@/lib/error-toast'

function lineRowClass(kind: DiffLine['kind']): string {
  if (kind === 'add') return 'bg-emerald-500/10'
  if (kind === 'remove') return 'bg-red-500/10'
  return ''
}

function linePrefix(kind: DiffLine['kind']): string {
  if (kind === 'add') return '+'
  if (kind === 'remove') return '-'
  return ' '
}

/** What to say about a file with no hunks on either side. */
function noHunksMessage(changeKind: string): string {
  if (changeKind === 'mode-change') return 'File mode changed, no content changes.'
  if (changeKind === 'renamed') return 'File renamed, no content changes.'
  return 'No changes.'
}

/**
 * The offer a hunk-less change (a mode-only flip, a pure rename, or a
 * binary file — see `isHunklessChange`) gets in place of a per-hunk button:
 * "stage this hunk" is meaningless when there's no hunk, so this says so
 * rather than leaving the file with no staging control at all.
 *
 * Kept in its simple whole-file form through #73, deliberately: there is no
 * hunk here to mark as staged in place, so there is nothing for the unified
 * view to unify.
 */
function WholeFileOffer({
  label,
  pending,
  onStage
}: {
  label: string
  pending: boolean
  onStage: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <p className="flex-1 text-muted-foreground">No individual hunks to stage.</p>
      <Button size="xs" variant="outline" disabled={pending} onClick={onStage}>
        {label}
      </Button>
    </div>
  )
}

/**
 * One hunk, marked in place with the side it is on (#73).
 *
 * A staged hunk carries an accent rail down its left edge and a "Staged"
 * badge in its header. Both, rather than either alone: the badge is what
 * says which of the two states this is in words, and the rail is what makes
 * a run of staged hunks legible while scrolling past them, which a badge on
 * each header does not.
 */
function HunkView({
  hunk,
  actionLabel,
  actionPending,
  onAction
}: {
  hunk: UnifiedHunk
  /** Omitted for a request kind (untracked, a historical commit) hunk staging doesn't apply to. */
  actionLabel?: string
  actionPending: boolean
  onAction: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const staged = hunk.side === 'staged'

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-side={hunk.side}
      className={`border-b last:border-b-0 ${staged ? 'border-l-2 border-l-primary' : ''}`}
    >
      <div
        className={`flex items-center gap-1.5 py-1 pr-1.5 pl-2 ${
          staged ? 'bg-primary/10 hover:bg-primary/15' : 'bg-muted/40 hover:bg-muted/70'
        }`}
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-xs text-muted-foreground">
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="truncate">{hunk.header}</span>
        </CollapsibleTrigger>
        {staged && (
          <Badge variant="secondary" className="shrink-0 font-sans text-[10px]">
            Staged
          </Badge>
        )}
        {actionLabel && (
          <Button
            size="xs"
            variant="outline"
            className="shrink-0 bg-background"
            disabled={actionPending}
            onClick={(event) => {
              event.stopPropagation()
              onAction()
            }}
          >
            {actionLabel}
          </Button>
        )}
      </div>
      <CollapsibleContent>
        {hunk.lines.map((line, index) =>
          line.kind === 'no-newline' ? (
            <div
              key={index}
              className="px-2 py-0.5 font-mono text-[11px] text-muted-foreground italic"
            >
              \ {line.text}
            </div>
          ) : (
            <div
              key={index}
              className={`grid grid-cols-[2.5rem_2.5rem_1fr] font-mono text-xs ${lineRowClass(line.kind)}`}
            >
              <span className="select-none px-1.5 text-right text-muted-foreground/70">
                {line.oldLine ?? ''}
              </span>
              <span className="select-none px-1.5 text-right text-muted-foreground/70">
                {line.newLine ?? ''}
              </span>
              <span className="min-w-0 px-1.5 break-all whitespace-pre-wrap">
                {linePrefix(line.kind)}
                {line.text}
              </span>
            </div>
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The third panel: a file's diff. Never mounted with nothing to show — the
 * caller only renders this when an inspector is open, so there's no empty
 * state to design for.
 *
 * Since #73 a tracked working-tree file is shown as one list with its staged
 * and unstaged hunks interleaved in file order, staged ones marked in place.
 * Before that, staging a hunk moved it into a separate Staged view and it
 * read as having vanished — the user had to know to go and look somewhere
 * else to confirm the thing they had just done. Now it stays where it was
 * and grows a badge.
 *
 * Each hunk keeps its own button, and what that button does follows from the
 * side it is on: stage an unstaged hunk, unstage a staged one. That is the
 * whole reason this merges two diffs rather than rendering one diff against
 * HEAD — see `mergeStagingSides`, which has the argument in full.
 *
 * An `'untracked'` file and a historical `'commit'` have only ever the one
 * side, so they take the same path with the staged query switched off and no
 * per-hunk buttons at all.
 */
export function DiffPanel({
  request,
  label,
  onClose
}: {
  request: DiffRequest
  /** Shown in the header before the diff has loaded. */
  label: string
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()

  const sides = stagingSides(request)
  // A tracked file queries both sides; everything else queries the one
  // request it was given and leaves the staged query disabled.
  const unstagedQuery = useFileDiff(sides?.unstaged ?? request)
  const stagedQuery = useFileDiff(sides?.staged ?? null)

  const [pendingHunkId, setPendingHunkId] = useState<string | null>(null)
  const [wholeFilePending, setWholeFilePending] = useState(false)

  // Neither an untracked file nor a historical commit has a `--cached` index
  // state to move a hunk into or out of.
  const actionable = sides !== null
  const pending = unstagedQuery.isPending || (actionable && stagedQuery.isPending)
  const error = unstagedQuery.error ?? stagedQuery.error

  const diff: UnifiedDiff | null =
    unstagedQuery.data || stagedQuery.data
      ? mergeStagingSides(unstagedQuery.data ?? null, stagedQuery.data ?? null)
      : null
  const stats = diff ? unifiedDiffStats(diff) : null
  const displayPath = diff ? (diff.newPath ?? diff.oldPath ?? label) : label

  const invalidate = (): void => {
    // Both sides, always: staging or unstaging a hunk changes each of them,
    // and the panel now has both on screen at once, so leaving either stale
    // shows the same hunk twice or not at all.
    queryClient.invalidateQueries({ queryKey: queryKeys.fileDiff(sides?.unstaged ?? request) })
    if (sides) queryClient.invalidateQueries({ queryKey: queryKeys.fileDiff(sides.staged) })
    if (request.kind === 'commit') return
    queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(request.worktreePath) })
  }

  const runApplyHunk = async (hunk: UnifiedHunk): Promise<void> => {
    // The literal check (rather than the `actionable` flag) is what lets
    // TypeScript narrow `request` to the variant with `worktreePath` below.
    if (request.kind === 'commit' || request.kind === 'untracked' || !hunk.id) return
    setPendingHunkId(hunk.id)
    try {
      await invoke(
        'worktree:applyHunk',
        request.worktreePath,
        { path: request.path, origPath: request.origPath ?? null },
        hunk.id,
        hunk.side === 'staged' ? 'unstage' : 'stage'
      )
      invalidate()
    } catch (cause) {
      if (cause instanceof AppError && cause.code === 'diff-stale') {
        toast.info('This file changed since the diff was shown — showing the latest version.')
        invalidate()
      } else {
        showErrorToast(hunk.side === 'staged' ? 'Could not unstage hunk' : 'Could not stage hunk', {
          description: (cause as Error).message
        })
      }
    } finally {
      setPendingHunkId(null)
    }
  }

  const runWholeFile = async (direction: 'stage' | 'unstage'): Promise<void> => {
    if (request.kind === 'commit') return
    setWholeFilePending(true)
    try {
      await invoke(
        direction === 'stage' ? 'workingTree:stage' : 'workingTree:unstage',
        request.worktreePath,
        wholeFilePathsFor(request)
      )
      invalidate()
    } catch (cause) {
      showErrorToast(direction === 'stage' ? 'Could not stage file' : 'Could not unstage file', {
        description: (cause as Error).message
      })
    } finally {
      setWholeFilePending(false)
    }
  }

  // Which way the whole-file offer points for a change no hunk can
  // represent: unstage it when the staged side is the one carrying it,
  // otherwise stage it.
  const wholeFileDirection: 'stage' | 'unstage' =
    diff?.hunkless.staged && !diff.hunkless.unstaged ? 'unstage' : 'stage'
  const wholeFileLabel = wholeFileDirection === 'stage' ? 'Stage file' : 'Unstage file'
  const showWholeFileOffer =
    actionable && diff !== null && (diff.binary || diff.hunkless.staged || diff.hunkless.unstaged)

  return (
    <div
      className="flex h-full flex-col"
      data-testid="diff-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="flex shrink-0 items-start gap-2 border-b p-4">
        <Checkbox
          checked={diff ? checkboxState(diff) : false}
          disabled
          className="mt-0.5"
          // Not "<path> staging state", which is the Changed Files row's own
          // label: the two would then be one accessible name for two
          // different controls, and this one is a read-only indicator while
          // that one stages the file.
          aria-label="Staging state"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{displayPath}</p>
          {stats && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="text-emerald-600 dark:text-emerald-400">+{stats.insertions}</span>
              {' • '}
              <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
              {' • '}
              <span className="font-mono">{displayPath}</span>
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {pending && (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-4 w-full" />
            ))}
          </div>
        )}

        {error && <CopyableError className="p-4 text-sm" message={(error as Error).message} />}

        {diff?.binary && (
          <div className="space-y-2 p-4 text-sm">
            <p className="text-muted-foreground">Binary file, not shown.</p>
          </div>
        )}

        {diff && !diff.binary && diff.hunks.length === 0 && (
          <div className="space-y-2 p-4 text-sm">
            <p className="text-muted-foreground">{noHunksMessage(diff.changeKind)}</p>
          </div>
        )}

        {showWholeFileOffer && (
          <div className="px-4 pb-4 text-sm">
            <WholeFileOffer
              label={wholeFileLabel}
              pending={wholeFilePending}
              onStage={() => void runWholeFile(wholeFileDirection)}
            />
          </div>
        )}

        {diff?.lossy && (
          <p className="border-b bg-amber-500/10 px-4 py-2 text-xs text-muted-foreground">
            This file isn&apos;t UTF-8; the diff shown is approximate.
          </p>
        )}

        {diff && diff.hunks.length > 0 && (
          <div>
            {diff.hunks.map((hunk, index) => (
              <HunkView
                // Index, not `hunk.id`: staging one hunk can change a
                // sibling's diff header, and so its id, with no change of
                // its own — see #73's note on hunk-identity instability.
                key={index}
                hunk={hunk}
                actionLabel={
                  actionable ? (hunk.side === 'staged' ? 'Unstage hunk' : 'Stage hunk') : undefined
                }
                actionPending={pendingHunkId === hunk.id}
                onAction={() => void runApplyHunk(hunk)}
              />
            ))}
          </div>
        )}

        {diff?.truncated && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            This diff is too large to show in full and has been truncated.
          </p>
        )}
      </ScrollArea>
    </div>
  )
}

/** Radix's `checked` prop, from the tri-state `unifiedStagingState` computes. */
function checkboxState(diff: UnifiedDiff): boolean | 'indeterminate' {
  const state = unifiedStagingState(diff)
  if (state === 'indeterminate') return 'indeterminate'
  return state === 'checked'
}
