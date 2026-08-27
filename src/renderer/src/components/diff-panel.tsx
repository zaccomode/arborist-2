import { useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { DiffHunk, DiffLine, DiffRequest } from '@shared/diff'
import {
  diffRequestIdentity,
  diffStats,
  isHunklessChange,
  wholeFilePathsFor,
  withDiffSide
} from '@shared/diff'
import { AppError } from '@shared/errors'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

/** What to say about a file with no hunks, before any whole-file staging offer. */
function noHunksMessage(file: { changeKind: string }): string {
  if (file.changeKind === 'mode-change') return 'File mode changed, no content changes.'
  if (file.changeKind === 'renamed') return 'File renamed, no content changes.'
  return 'No changes.'
}

/**
 * The offer a hunk-less change (a mode-only flip, a pure rename, or a
 * binary file — see `isHunklessChange`) gets in place of a per-hunk button:
 * "stage this hunk" is meaningless when there's no hunk, so this says so
 * rather than leaving the file with no staging control at all.
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

function HunkView({
  hunk,
  actionLabel,
  actionPending,
  onAction
}: {
  hunk: DiffHunk
  /** Omitted for a request kind (untracked, a historical commit) hunk staging doesn't apply to. */
  actionLabel?: string
  actionPending: boolean
  onAction: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <div className="flex items-center gap-1.5 bg-muted/40 py-1 pr-1.5 pl-2 hover:bg-muted/70">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-xs text-muted-foreground">
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="truncate">{hunk.header}</span>
        </CollapsibleTrigger>
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
 * Staging lives at two grains, per #49: a hunk button on each `HunkView`
 * when the request is `'unstaged'` or `'staged'` (an `'untracked'` file or a
 * historical `'commit'` has nothing for `worktree:applyHunk` to re-diff
 * against, so neither offers one), and a whole-file offer wherever
 * `isHunklessChange` says a hunk can't represent the change at all — a
 * mode-only flip, a pure rename, or a binary file.
 *
 * A partially-staged file (`MM`, or an `AM` partially-staged new file) has
 * real content on both the unstaged and staged side at once, but `request`
 * only ever names one of them — `diffSideFor` picks staged, since that's
 * what the next commit will contain. Staging one of several hunks from that
 * side would otherwise strand the user there with no way back to the rest:
 * re-clicking the row can only ever reopen the side `diffSideFor` prefers.
 * `hasBothSides` says when that's live, and the Unstaged/Staged tabs below
 * let the user flip without closing and reopening the panel.
 */
export function DiffPanel({
  request,
  label,
  hasBothSides,
  onClose
}: {
  request: DiffRequest
  /** Shown in the header before the diff has loaded. */
  label: string
  /** Whether to offer the Unstaged/Staged toggle — see the doc comment above. */
  hasBothSides: boolean
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()

  // The side the user picked with the toggle, overriding `request.kind`
  // until the panel is asked to show a different file — see
  // `diffRequestIdentity`. Reset here, during render, rather than in an
  // effect: an effect would run the initial "unstaged" render before
  // snapping back, flashing the wrong side for a frame.
  const identity = diffRequestIdentity(request)
  const [priorIdentity, setPriorIdentity] = useState(identity)
  const [manualSide, setManualSide] = useState<'unstaged' | 'staged' | null>(null)
  if (identity !== priorIdentity) {
    setPriorIdentity(identity)
    setManualSide(null)
  }
  // Also reset the moment the file stops having two sides to choose
  // between — typically because a stage/unstage from within this very
  // panel resolved the last hunk on the other side. `request.kind` was
  // fixed at whatever `diffSideFor` preferred when the panel was opened, so
  // falling back to it here lands back on the side that still has content,
  // rather than leaving the user stranded on a manually-picked side that
  // just went empty with the toggle no longer there to escape it.
  const [priorHasBothSides, setPriorHasBothSides] = useState(hasBothSides)
  if (hasBothSides !== priorHasBothSides) {
    setPriorHasBothSides(hasBothSides)
    if (!hasBothSides) setManualSide(null)
  }

  const activeRequest = withDiffSide(request, manualSide)

  const query = useFileDiff(activeRequest)
  const file = query.data
  const stats = file ? diffStats(file) : null
  const displayPath = file ? (file.newPath ?? file.oldPath ?? label) : label

  const [pendingHunkId, setPendingHunkId] = useState<string | null>(null)
  const [wholeFilePending, setWholeFilePending] = useState(false)

  // Neither an untracked file nor a historical commit has a `--cached`
  // index state to move a hunk into or out of.
  const actionable = activeRequest.kind === 'unstaged' || activeRequest.kind === 'staged'
  const direction: 'stage' | 'unstage' = activeRequest.kind === 'staged' ? 'unstage' : 'stage'
  const showSideToggle = hasBothSides && actionable

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.fileDiff(activeRequest) })
    if (activeRequest.kind === 'commit') return
    queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(activeRequest.worktreePath) })
    // Staging or unstaging a hunk changes both sides of this file's diff at
    // once. The default 15s staleTime means the sibling view (staged when
    // this one is unstaged, or vice versa) would otherwise go on showing
    // what was true before this action for as long as that window lasts,
    // the moment the user switches to it — invalidating only `activeRequest`
    // leaves that stale.
    if (activeRequest.kind === 'unstaged' || activeRequest.kind === 'staged') {
      const sibling: DiffRequest = {
        ...activeRequest,
        kind: activeRequest.kind === 'unstaged' ? 'staged' : 'unstaged'
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.fileDiff(sibling) })
    }
  }

  const runApplyHunk = async (hunk: DiffHunk): Promise<void> => {
    // The literal checks (rather than the `actionable` flag above) are what
    // let TypeScript narrow `activeRequest` to the variant with
    // `worktreePath` below — `actionable` is just a boolean, with no link
    // back to it.
    if (activeRequest.kind === 'commit' || activeRequest.kind === 'untracked' || !hunk.id) return
    setPendingHunkId(hunk.id)
    try {
      await invoke(
        'worktree:applyHunk',
        activeRequest.worktreePath,
        { path: activeRequest.path, origPath: activeRequest.origPath ?? null },
        hunk.id,
        direction
      )
      invalidate()
    } catch (cause) {
      if (cause instanceof AppError && cause.code === 'diff-stale') {
        toast.info('This file changed since the diff was shown — showing the latest version.')
        invalidate()
      } else {
        showErrorToast(direction === 'stage' ? 'Could not stage hunk' : 'Could not unstage hunk', {
          description: (cause as Error).message
        })
      }
    } finally {
      setPendingHunkId(null)
    }
  }

  const runWholeFileStage = async (): Promise<void> => {
    if (activeRequest.kind === 'commit') return
    setWholeFilePending(true)
    try {
      const paths = wholeFilePathsFor(activeRequest)
      await invoke(
        direction === 'stage' ? 'workingTree:stage' : 'workingTree:unstage',
        activeRequest.worktreePath,
        paths
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

  const wholeFileLabel = direction === 'stage' ? 'Stage file' : 'Unstage file'
  const hunkActionLabel = actionable
    ? direction === 'stage'
      ? 'Stage hunk'
      : 'Unstage hunk'
    : undefined

  return (
    <div
      className="flex h-full flex-col"
      data-testid="diff-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="flex shrink-0 items-start gap-2 border-b p-4">
        <Checkbox checked={activeRequest.kind === 'staged'} disabled className="mt-0.5" />
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

      {showSideToggle && (
        <div className="shrink-0 border-b px-4 py-2">
          <Tabs
            value={activeRequest.kind}
            onValueChange={(value) => setManualSide(value as 'unstaged' | 'staged')}
          >
            <TabsList variant="line" className="w-fit">
              <TabsTrigger value="unstaged">Unstaged</TabsTrigger>
              <TabsTrigger value="staged">Staged</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {query.isPending && (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-4 w-full" />
            ))}
          </div>
        )}

        {query.error && (
          <CopyableError className="p-4 text-sm" message={(query.error as Error).message} />
        )}

        {file?.binary && (
          <div className="space-y-2 p-4 text-sm">
            <p className="text-muted-foreground">Binary file, not shown.</p>
            {actionable && (
              <WholeFileOffer
                label={wholeFileLabel}
                pending={wholeFilePending}
                onStage={() => void runWholeFileStage()}
              />
            )}
          </div>
        )}

        {file && !file.binary && file.hunks.length === 0 && (
          <div className="space-y-2 p-4 text-sm">
            <p className="text-muted-foreground">{noHunksMessage(file)}</p>
            {actionable && isHunklessChange(file) && (
              <WholeFileOffer
                label={wholeFileLabel}
                pending={wholeFilePending}
                onStage={() => void runWholeFileStage()}
              />
            )}
          </div>
        )}

        {file?.lossy && (
          <p className="border-b bg-amber-500/10 px-4 py-2 text-xs text-muted-foreground">
            This file isn&apos;t UTF-8; the diff shown is approximate.
          </p>
        )}

        {file && file.hunks.length > 0 && (
          <div>
            {file.hunks.map((hunk, index) => (
              <HunkView
                key={index}
                hunk={hunk}
                actionLabel={hunkActionLabel}
                actionPending={pendingHunkId === hunk.id}
                onAction={() => void runApplyHunk(hunk)}
              />
            ))}
          </div>
        )}

        {file?.truncated && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            This diff is too large to show in full and has been truncated.
          </p>
        )}
      </ScrollArea>
    </div>
  )
}
