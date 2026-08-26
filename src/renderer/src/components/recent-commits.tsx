import { useState } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import type { CommitLogEntry } from '@shared/domain'
import { formatCommitTimestamp } from '@shared/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyableError } from '@/components/copyable-error'
import { invoke } from '@/api/client'
import { useCommitLog } from '@/api/queries'

function CommitRow({ commit }: { commit: CommitLogEntry }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  return (
    <li className="flex gap-3 py-3 first:pt-0">
      <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
          <span className="truncate text-sm font-semibold">{commit.author}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatCommitTimestamp(commit.date)}
          </span>
        </p>
        <p className="text-sm break-words">{commit.subject}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <button
            type="button"
            title="Copy commit hash"
            onClick={() => {
              void invoke('system:copyText', commit.hash)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
            className="font-mono hover:text-foreground"
          >
            {copied ? 'Copied' : commit.shortHash}
          </button>
          <span>&bull;</span>
          <span>
            {commit.filesChanged} file{commit.filesChanged === 1 ? '' : 's'} changed
          </span>
          {commit.insertions > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">+{commit.insertions}</span>
          )}
          {commit.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400">&minus;{commit.deletions}</span>
          )}
        </p>
      </div>
    </li>
  )
}

/**
 * A flat commit list for a single ref — used only for a remote branch with
 * no local checkout (`RemoteBranchDetail`), where there's no worktree to
 * pair with an upstream and no lanes worth drawing for one ref alone.
 * `repoPath` only has to be somewhere inside the repository, since
 * remote-tracking refs are visible from any worktree that shares it.
 *
 * A worktree's own Commit Graph tab uses `<CommitGraph>` instead — lanes,
 * a click-through commit inspector, and the branch-plus-upstream ref pair
 * this component was never asked to handle.
 */
export function RecentCommits({
  repoPath,
  gitRef
}: {
  repoPath: string
  /** The worktree's branch, its HEAD hash when detached, or a remote ref. */
  gitRef: string | null
}): React.JSX.Element | null {
  const query = useCommitLog(repoPath, gitRef)
  const commits = query.data?.pages.flat() ?? []

  if (!gitRef) return null

  return (
    <section className="mt-6">
      <p className="text-xs font-medium text-muted-foreground">Recent Commits</p>

      {query.isPending && (
        <div className="mt-2 space-y-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </div>
      )}

      {!query.isPending && commits.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">No commits yet.</p>
      )}

      {commits.length > 0 && (
        <ul data-testid="recent-commits" className="mt-1 divide-y">
          {commits.map((commit) => (
            <CommitRow key={commit.hash} commit={commit} />
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
