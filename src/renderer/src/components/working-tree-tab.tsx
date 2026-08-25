import type { ChangedFile } from '@shared/domain'
import { splitDisplayPath, stagingState, statusLabel } from '@shared/working-tree'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkingTree } from '@/api/queries'

/** Radix's `checked` prop, from the tri-state model `stagingState` computes. */
function checkboxState(state: ReturnType<typeof stagingState>): boolean | 'indeterminate' {
  if (state === 'indeterminate') return 'indeterminate'
  return state === 'checked'
}

function FileRow({ file }: { file: ChangedFile }): React.JSX.Element {
  const { name, dir } = splitDisplayPath(file.path)

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <Checkbox
        checked={checkboxState(stagingState(file))}
        disabled
        aria-label={`${file.path} staging state`}
      />
      <span className="max-w-[40%] shrink-0 truncate">{name}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dir}</span>
      <Badge variant="outline" className="ml-auto shrink-0 font-mono text-[11px]">
        {statusLabel(file)}
      </Badge>
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
export function WorkingTreeTab({ worktreePath }: { worktreePath: string }): React.JSX.Element {
  const query = useWorkingTree(worktreePath)
  const files = query.data?.files ?? []
  const allStaged = files.length > 0 && files.every((file) => stagingState(file) === 'checked')
  const anyStaged = files.some((file) => stagingState(file) !== 'unchecked')

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
              <FileRow key={file.path} file={file} />
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
