import { useState } from 'react'
import { ChevronLeft, GitMerge, X } from 'lucide-react'
import type { CommitFileStat } from '@shared/domain'
import type { DiffRequest } from '@shared/diff'
import { formatCommitTimestamp } from '@shared/format'
import { splitDisplayPath } from '@shared/working-tree'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { DiffPanel } from '@/components/diff-panel'
import { FilePathCell } from '@/components/file-path-cell'
import { invoke } from '@/api/client'
import { useCommit, useCommitFiles } from '@/api/queries'

/**
 * One file in the commit inspector's file list. The concept says this panel
 * "looks similar" to the Working Tree tab's, which invites reusing that
 * `FileRow` wholesale — resist it: these rows have no checkboxes (a
 * historical commit can't be re-staged) and no context menu. `FilePathCell`
 * is the primitive the two share; everything staging-shaped stays out of
 * this one.
 */
function CommitFileRow({
  file,
  onSelect
}: {
  file: CommitFileStat
  onSelect: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-label={file.path}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
      >
        <FilePathCell path={file.path} />
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
          {file.binary ? (
            'binary'
          ) : (
            <>
              {(file.insertions ?? 0) > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">+{file.insertions}</span>
              )}
              {(file.insertions ?? 0) > 0 && (file.deletions ?? 0) > 0 && ' '}
              {(file.deletions ?? 0) > 0 && (
                <span className="text-red-600 dark:text-red-400">&minus;{file.deletions}</span>
              )}
            </>
          )}
        </span>
      </button>
    </li>
  )
}

/**
 * The third panel opened by clicking a row in the Commit Graph: the
 * commit's metadata and its changed files, per the concept note — clicking
 * one of those shows its patch, reusing the diff panel's existing `'commit'`
 * request kind (#46) rather than a second diff renderer. Closing the panel
 * (the X, or Escape from the file view) always leaves the whole inspector,
 * even from the nested file view — "back" is the only way to return to the
 * file list without leaving the panel entirely.
 *
 * The caller keys this on `hash` (`key={inspector.hash}` in `App.tsx`), so a
 * fresh row click in the graph remounts it and drops any file drill-down
 * left over from the previous commit — simpler and more idiomatic than an
 * effect resetting `selectedFile` on every render this component's own
 * `hash` prop changes.
 */
export function CommitInspector({
  repoPath,
  hash,
  onClose
}: {
  repoPath: string
  hash: string
  onClose: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{
    path: string
    origPath: string | null
  } | null>(null)

  const commitQuery = useCommit(repoPath, hash)
  const filesQuery = useCommitFiles(repoPath, hash)
  const commit = commitQuery.data
  const files = filesQuery.data ?? []
  const isMerge = (commit?.parents.length ?? 0) > 1

  if (selectedFile) {
    const request: DiffRequest = {
      kind: 'commit',
      repoPath,
      hash,
      path: selectedFile.path,
      origPath: selectedFile.origPath
    }
    return (
      <div className="flex h-full flex-col" data-testid="commit-inspector">
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to commit"
            onClick={() => setSelectedFile(null)}
          >
            <ChevronLeft />
          </Button>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {commit?.shortHash ?? hash.slice(0, 7)}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <DiffPanel
            request={request}
            label={splitDisplayPath(selectedFile.path).name}
            onClose={onClose}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="commit-inspector">
      <div className="flex shrink-0 items-start gap-2 border-b p-4">
        <div className="min-w-0 flex-1">
          {commitQuery.isPending && <Skeleton className="h-5 w-2/3" />}
          {commit && (
            <>
              <p className="flex items-baseline gap-1.5">
                {isMerge && <GitMerge className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate font-semibold break-words">{commit.subject}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {commit.author} &bull; {formatCommitTimestamp(commit.date)}
              </p>
              <button
                type="button"
                title="Copy commit hash"
                onClick={() => {
                  void invoke('system:copyText', commit.hash)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                }}
                className="mt-1 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                {copied ? 'Copied' : commit.hash}
              </button>
            </>
          )}
          {commitQuery.error && (
            <p className="text-xs text-destructive">{(commitQuery.error as Error).message}</p>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {filesQuery.isPending && (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-4 w-full" />
            ))}
          </div>
        )}

        {!filesQuery.isPending && files.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No files changed.</p>
        )}

        {files.length > 0 && (
          <ul data-testid="commit-files" className="divide-y">
            {files.map((file) => (
              <CommitFileRow
                key={file.path}
                file={file}
                onSelect={() => setSelectedFile({ path: file.path, origPath: file.origPath })}
              />
            ))}
          </ul>
        )}

        {filesQuery.error && (
          <p className="p-4 text-xs text-destructive">{(filesQuery.error as Error).message}</p>
        )}
      </ScrollArea>
    </div>
  )
}
