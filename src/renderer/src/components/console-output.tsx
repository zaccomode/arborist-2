import { useEffect, useRef } from 'react'
import { CheckCircle2, CircleDashed, CircleX, Loader2 } from 'lucide-react'
import type { CommandState } from '@/state/automation-run'

/** The command list and its streamed output, scrolled to whatever is newest. */
export function ConsoleOutput({
  commands,
  testId
}: {
  commands: CommandState[]
  testId?: string
}): React.JSX.Element {
  const outputRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [commands])

  return (
    <div
      ref={outputRef}
      data-testid={testId}
      className="max-h-[50vh] min-h-40 overflow-y-auto rounded-md border"
    >
      {commands.map((entry, index) => (
        <div key={index} className="border-b p-3 last:border-b-0">
          <div className="flex items-center gap-2 font-mono text-xs">
            <StatusIcon status={entry.status} />
            <span className="truncate">{entry.command}</span>
          </div>
          {entry.output && (
            <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {entry.output}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

function StatusIcon({ status }: { status: CommandState['status'] }): React.JSX.Element {
  switch (status) {
    case 'running':
      return <Loader2 className="size-3.5 shrink-0 animate-spin" />
    case 'succeeded':
      return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
    case 'failed':
      return <CircleX className="size-3.5 shrink-0 text-destructive" />
    default:
      return <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />
  }
}
