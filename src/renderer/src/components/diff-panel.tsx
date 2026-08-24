import { useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { DiffHunk, DiffLine, DiffRequest } from '@shared/diff'
import { diffStats } from '@shared/diff'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useFileDiff } from '@/api/queries'

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

function HunkView({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 bg-muted/40 px-2 py-1 text-left font-mono text-xs text-muted-foreground hover:bg-muted/70">
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="truncate">{hunk.header}</span>
      </CollapsibleTrigger>
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
  const query = useFileDiff(request)
  const file = query.data
  const stats = file ? diffStats(file) : null
  const displayPath = file ? (file.newPath ?? file.oldPath ?? label) : label

  return (
    <div
      className="flex h-full flex-col"
      data-testid="diff-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="flex shrink-0 items-start gap-2 border-b p-4">
        <Checkbox checked={request.kind === 'staged'} disabled className="mt-0.5" />
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
        {query.isPending && (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-4 w-full" />
            ))}
          </div>
        )}

        {query.error && (
          <p className="p-4 text-sm text-destructive">{(query.error as Error).message}</p>
        )}

        {file?.binary && (
          <p className="p-4 text-sm text-muted-foreground">Binary file, not shown.</p>
        )}

        {file && !file.binary && file.hunks.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {file.changeKind === 'mode-change'
              ? 'File mode changed, no content changes.'
              : 'No changes.'}
          </p>
        )}

        {file?.lossy && (
          <p className="border-b bg-amber-500/10 px-4 py-2 text-xs text-muted-foreground">
            This file isn&apos;t UTF-8; the diff shown is approximate.
          </p>
        )}

        {file && file.hunks.length > 0 && (
          <div>
            {file.hunks.map((hunk, index) => (
              <HunkView key={index} hunk={hunk} />
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
