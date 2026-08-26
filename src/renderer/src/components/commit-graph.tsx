import { useMemo } from 'react'
import { GitMerge } from 'lucide-react'
import type { CommitLogEntry, Worktree } from '@shared/domain'
import { assignLanes, type GraphRow } from '@shared/commit-graph'
import { commitGraphScopeLabel, commitGraphTips, formatCommitTimestamp } from '@shared/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyableError } from '@/components/copyable-error'
import { useCommitLog } from '@/api/queries'
import { useWorktreeInspector } from '@/state/selection'

/** Matches the SVG rail spec: `laneCount * 12` wide. */
const LANE_WIDTH = 12
/** Fixed so the rail can be one small `<svg>` per row rather than one tall one spanning the whole list. */
const ROW_HEIGHT = 72

// Literal class names, not built from a template string: Tailwind's content
// scanner has to find the whole class name as text in a scanned file, and a
// computed `stroke-chart-${n}` never matches that scan.
const LANE_STROKE = [
  'stroke-chart-1',
  'stroke-chart-2',
  'stroke-chart-3',
  'stroke-chart-4',
  'stroke-chart-5'
]
const LANE_FILL = ['fill-chart-1', 'fill-chart-2', 'fill-chart-3', 'fill-chart-4', 'fill-chart-5']

function laneStroke(lane: number): string {
  return LANE_STROKE[lane % LANE_STROKE.length]
}

function laneFill(lane: number): string {
  return LANE_FILL[lane % LANE_FILL.length]
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2
}

/**
 * One row's rail: a dot at `row.lane`, a vertical for every lane merely
 * passing through, and a curve for every edge. Each row draws its own
 * fixed-height SVG rather than one continuous one spanning the whole list —
 * simpler to keep aligned with rows whose text can wrap, and cheap since
 * only what's on screen mounts.
 */
function CommitGraphRail({ row }: { row: GraphRow<CommitLogEntry> }): React.JSX.Element {
  const width = row.laneCount * LANE_WIDTH
  const cx = laneX(row.lane)
  const cy = ROW_HEIGHT / 2
  const isMerge = row.commit.parents.length > 1
  const hasFirstParent = row.commit.parents.length > 0
  const firstParentDangling = hasFirstParent && row.danglingParents.includes(row.commit.parents[0])
  // A dangling stub reads as "fading toward the edge": short, and dim
  // rather than solid, instead of a line to a row that doesn't exist.
  const stubEnd = cy + (ROW_HEIGHT - cy) * 0.5

  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0 text-border" aria-hidden>
      {row.throughLanes.map((lane) => (
        <line
          key={`through-${lane}`}
          x1={laneX(lane)}
          x2={laneX(lane)}
          y1={0}
          y2={ROW_HEIGHT}
          strokeWidth={2}
          stroke="currentColor"
          className={laneStroke(lane)}
        />
      ))}

      {!row.newLane && (
        <line
          x1={cx}
          x2={cx}
          y1={0}
          y2={cy}
          strokeWidth={2}
          stroke="currentColor"
          className={laneStroke(row.lane)}
        />
      )}

      {hasFirstParent && !firstParentDangling && (
        <line
          x1={cx}
          x2={cx}
          y1={cy}
          y2={ROW_HEIGHT}
          strokeWidth={2}
          stroke="currentColor"
          className={laneStroke(row.lane)}
        />
      )}
      {firstParentDangling && (
        <line
          x1={cx}
          x2={cx}
          y1={cy}
          y2={stubEnd}
          strokeWidth={2}
          strokeOpacity={0.35}
          stroke="currentColor"
          className={laneStroke(row.lane)}
        />
      )}

      {row.edges.map((edge, index) => {
        const ex = laneX(edge.lane)
        if (edge.kind === 'merge') {
          // Another lane's line curves in from directly above to join this dot.
          return (
            <path
              key={`edge-${index}`}
              d={`M ${ex} 0 C ${ex} ${cy / 2}, ${cx} ${cy / 2}, ${cx} ${cy}`}
              fill="none"
              strokeWidth={2}
              stroke="currentColor"
              className={laneStroke(edge.lane)}
            />
          )
        }
        const endY = edge.dangling ? stubEnd : ROW_HEIGHT
        const midY = (cy + endY) / 2
        return (
          <path
            key={`edge-${index}`}
            d={`M ${cx} ${cy} C ${cx} ${midY}, ${ex} ${midY}, ${ex} ${endY}`}
            fill="none"
            strokeWidth={2}
            strokeOpacity={edge.dangling ? 0.35 : 1}
            stroke="currentColor"
            className={laneStroke(edge.lane)}
          />
        )
      })}

      {isMerge ? (
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill="var(--color-background)"
          strokeWidth={2}
          stroke="currentColor"
          className={laneStroke(row.lane)}
        />
      ) : (
        <circle cx={cx} cy={cy} r={4} fill="currentColor" className={laneFill(row.lane)} />
      )}
    </svg>
  )
}

function CommitGraphRow({
  row,
  selected,
  onSelect
}: {
  row: GraphRow<CommitLogEntry>
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const commit = row.commit
  const isMerge = commit.parents.length > 1

  return (
    <li className="flex border-b last:border-b-0">
      <div style={{ width: row.laneCount * LANE_WIDTH, height: ROW_HEIGHT }} className="shrink-0">
        <CommitGraphRail row={row} />
      </div>
      <button
        type="button"
        onClick={onSelect}
        style={{ height: ROW_HEIGHT }}
        aria-label={`${commit.subject}, ${commit.shortHash}`}
        aria-pressed={selected}
        className={`min-w-0 flex-1 px-2 py-2 text-left text-sm hover:bg-accent ${
          selected ? 'bg-accent' : ''
        }`}
      >
        <p className="flex items-baseline gap-1.5 truncate">
          {isMerge && <GitMerge className="size-3 shrink-0 self-center text-muted-foreground" />}
          <span className="truncate font-semibold">{commit.author}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatCommitTimestamp(commit.date)}
          </span>
        </p>
        <p className="truncate">{commit.subject}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{commit.shortHash}</span>
          {' • '}
          {commit.filesChanged} file{commit.filesChanged === 1 ? '' : 's'} changed
          {commit.insertions > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400"> +{commit.insertions}</span>
          )}
          {commit.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400"> &minus;{commit.deletions}</span>
          )}
        </p>
      </button>
    </li>
  )
}

/**
 * The Commit Graph tab: recent commits on a worktree's branch and its
 * upstream, as lanes rather than the flat list `RecentCommits` still shows
 * for a remote branch with no local checkout (see that component's own
 * doc comment for why it keeps its separate, simpler shape).
 */
export function CommitGraph({
  repositoryId,
  repoPath,
  worktree
}: {
  repositoryId: string
  repoPath: string
  worktree: Worktree
}): React.JSX.Element | null {
  const tips = commitGraphTips(worktree)
  const query = useCommitLog(repoPath, tips.length > 0 ? tips : null)
  const [inspector, openInspector] = useWorktreeInspector(repositoryId, worktree.path)

  // The fold has to run over every loaded page at once, never one page at a
  // time — a lane a fork opened three pages back has to still be "waiting"
  // when the fold reaches the commit that closes it. Keyed on `query.data`
  // (a fresh object each time a page resolves) rather than page count alone,
  // so a wholesale refetch — see `useCommitLog`'s doc comment on why `--skip`
  // is safe here — recomputes too, not just a genuine "load more".
  const rows = useMemo(() => assignLanes(query.data?.pages.flat() ?? []), [query.data])

  if (tips.length === 0) return null

  return (
    <section className="mt-6" data-testid="commit-graph">
      <p className="text-xs font-medium text-muted-foreground">{commitGraphScopeLabel(worktree)}</p>

      {query.isPending && (
        <div className="mt-2 space-y-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </div>
      )}

      {!query.isPending && rows.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">No commits yet.</p>
      )}

      {rows.length > 0 && (
        <ul data-testid="commit-graph-rows" className="mt-1">
          {rows.map((row) => (
            <CommitGraphRow
              key={row.commit.hash}
              row={row}
              selected={inspector?.kind === 'commit' && inspector.hash === row.commit.hash}
              onSelect={() => openInspector({ kind: 'commit', hash: row.commit.hash })}
            />
          ))}
        </ul>
      )}

      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 font-normal text-muted-foreground"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more
        </Button>
      )}

      {query.error && (
        <CopyableError className="mt-1 text-xs" message={(query.error as Error).message} />
      )}
    </section>
  )
}
