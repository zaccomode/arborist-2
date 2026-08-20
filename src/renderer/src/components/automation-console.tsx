import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleDashed, CircleX, Loader2 } from 'lucide-react'
import type { AutomationEvent, AutomationStatus } from '@shared/automation'
import type { SubstitutionValues } from '@shared/substitution'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { invoke } from '@/api/client'

interface CommandState {
  command: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  output: string
}

export interface AutomationTarget {
  repositoryId: string
  worktreePath: string
  values: SubstitutionValues
}

/**
 * Live output from a setup run. Not dismissable while commands are still
 * running: cancelling is a decision, and closing the window is not the same
 * thing as making it.
 */
export function AutomationConsole({
  target,
  onClose
}: {
  target: AutomationTarget | null
  onClose: () => void
}): React.JSX.Element | null {
  const [runId, setRunId] = useState<string | null>(null)
  // Events arrive for whichever run is current, and a retry starts a new one,
  // so the filter has to read the latest id rather than the one captured when
  // the subscription was made.
  const runIdRef = useRef<string | null>(null)
  const [commands, setCommands] = useState<CommandState[]>([])
  const [status, setStatus] = useState<AutomationStatus>('running')
  const [failedIndex, setFailedIndex] = useState<number | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const applyEvent = (event: AutomationEvent): void => {
      switch (event.type) {
        case 'started':
          setStatus('running')
          setFailedIndex(null)
          setCommands(
            event.commands.map((command, index) => ({
              command,
              status: index < event.startIndex ? 'skipped' : 'pending',
              output: ''
            }))
          )
          break
        case 'command-started':
          setCommands((current) =>
            current.map((entry, index) =>
              index === event.index
                ? // The substituted form, which is what actually ran.
                  { ...entry, command: event.command, status: 'running', output: '' }
                : entry
            )
          )
          break
        case 'output':
          setCommands((current) =>
            current.map((entry, index) =>
              index === event.index ? { ...entry, output: entry.output + event.chunk } : entry
            )
          )
          break
        case 'command-finished':
          setCommands((current) =>
            current.map((entry, index) =>
              index === event.index
                ? { ...entry, status: event.exitCode === 0 ? 'succeeded' : 'failed' }
                : entry
            )
          )
          break
        case 'finished':
          setStatus(event.status)
          setFailedIndex(event.failedIndex)
          break
      }
    }

    return window.arborist.subscribe('automation:event', (event: AutomationEvent) => {
      if (runIdRef.current && event.runId !== runIdRef.current) return
      applyEvent(event)
    })
  }, [])

  const start = (startIndex: number): void => {
    if (!target) return
    setStatus('running')
    void invoke('automation:start', { ...target, startIndex }).then((id) => {
      runIdRef.current = id
      setRunId(id)
    })
  }

  useEffect(() => {
    if (!target) return
    void invoke('automation:start', {
      repositoryId: target.repositoryId,
      worktreePath: target.worktreePath,
      values: target.values,
      startIndex: 0
    }).then((id) => {
      runIdRef.current = id
      setRunId(id)
    })
  }, [target])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [commands])

  if (!target) return null

  const running = status === 'running'
  const finishedCount = commands.filter((entry) => entry.status === 'succeeded').length
  const heading = running
    ? `Running ${Math.min(finishedCount + 1, commands.length)} of ${commands.length}`
    : status === 'completed'
      ? `Completed ${commands.length} commands`
      : status === 'cancelled'
        ? 'Cancelled'
        : `Failed at command ${(failedIndex ?? 0) + 1}`

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // While it runs, the only way out is Cancel.
        if (!next && !running) onClose()
      }}
    >
      <DialogContent
        data-testid="automation-console"
        className="max-w-2xl sm:max-w-2xl"
        showCloseButton={!running}
      >
        <DialogHeader>
          <DialogTitle>Setup automation</DialogTitle>
          <DialogDescription data-testid="automation-status">{heading}</DialogDescription>
        </DialogHeader>

        <div ref={outputRef} className="max-h-[50vh] min-h-40 overflow-y-auto rounded-md border">
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

        <DialogFooter>
          {running ? (
            <Button
              variant="destructive"
              onClick={() => runId && void invoke('automation:cancel', runId)}
            >
              Cancel
            </Button>
          ) : (
            <>
              {failedIndex !== null && (
                <Button variant="outline" onClick={() => start(failedIndex)}>
                  Retry from failed
                </Button>
              )}
              <Button variant="outline" onClick={() => start(0)}>
                Run again
              </Button>
              <Button onClick={onClose}>Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
