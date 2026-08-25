import { useEffect } from 'react'
import type { ChangedFile } from '@shared/domain'
import {
  diffSideFor,
  isInspectable,
  splitDisplayPath,
  stagingState,
  statusKind,
  statusLabel,
  type StatusKind
} from '@shared/working-tree'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkingTree } from '@/api/queries'
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
  onSelect
}: {
  file: ChangedFile
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { name, dir } = splitDisplayPath(file.path)
  const clickable = isInspectable(file)

  return (
    <li>
      <button
        type="button"
        disabled={!clickable}
        onClick={onSelect}
        title={clickable ? undefined : 'Resolve this conflict in your editor'}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm enabled:hover:bg-accent ${
          selected ? 'bg-accent' : ''
        } disabled:cursor-not-allowed`}
      >
        <Checkbox
          checked={checkboxState(stagingState(file))}
          disabled
          // Decorative only this phase (staging isn't wired until #48) — it
          // must not swallow the row's own click, or the leftmost slice of
          // every row becomes a dead zone for opening the diff panel.
          className="pointer-events-none"
          aria-label={`${file.path} staging state`}
        />
        {/* The directory concatenates first: shrink-0 keeps the filename at
            its natural width, so only the path gives up space as the row
            narrows. truncate on the filename is a last-resort fallback for
            when the row can't fit it even with the path fully collapsed. */}
        <span className="shrink-0 truncate">{name}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dir}</span>
        <Badge
          variant="outline"
          className={`ml-auto shrink-0 font-mono text-[11px] ${STATUS_COLOR[statusKind(file)]}`}
        >
          {statusLabel(file)}
        </Badge>
      </button>
    </li>
  )
}

/**
 * Read-only this phase (v3 Phase 3, #45): rows reflect the checkbox model
 * `git add`/`git restore --staged` will implement in Phase 5 (#48), but
 * nothing here is wired to either yet — the checkboxes are disabled and
 * exist so that phase's diff is about behaviour, not markup.
 *
 * Checked means "will be in the next commit": a file staged and unstaged at
 * once (`MM`) renders as one indeterminate row rather than two.
 */
export function WorkingTreeTab({
  repositoryId,
  worktreePath
}: {
  repositoryId: string
  worktreePath: string
}): React.JSX.Element {
  const query = useWorkingTree(worktreePath)
  const data = query.data
  const files = data?.files ?? []
  const allStaged = files.length > 0 && files.every((file) => stagingState(file) === 'checked')
  const anyStaged = files.some((file) => stagingState(file) !== 'unchecked')
  const [inspector, openInspector, closeInspector] = useWorktreeInspector(
    repositoryId,
    worktreePath
  )

  useEffect(() => {
    // The file this inspector is showing no longer has any changes — it was
    // committed, discarded, or reverted outside Arborist — so reading-in-
    // progress on stale content isn't worth keeping around.
    if (!data || inspector?.kind !== 'file') return
    if (!data.files.some((file) => file.path === inspector.path)) closeInspector()
  }, [data, inspector, closeInspector])

  return (
    <div>
      {query.isPending && (
        <div className="space-y-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      )}

      {!query.isPending && files.length === 0 && (
        <p className="text-sm text-muted-foreground">No changes.</p>
      )}

      {files.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
            <Checkbox
              checked={allStaged ? true : anyStaged ? 'indeterminate' : false}
              disabled
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
              />
            ))}
          </ul>
        </div>
      )}

      {query.error && (
        <p className="mt-2 text-xs text-destructive">{(query.error as Error).message}</p>
      )}
    </div>
  )
}
