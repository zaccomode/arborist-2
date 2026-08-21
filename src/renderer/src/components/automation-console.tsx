import { useEffect, useState } from 'react'
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
import { ConsoleOutput } from '@/components/console-output'
import { useAutomationRun } from '@/state/automation-run'
import { invoke } from '@/api/client'

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
  // so the id has to be the latest rather than the one this began with.
  const { commands, status, failedIndex } = useAutomationRun(runId)

  const start = (startIndex: number): void => {
    if (!target) return
    void invoke('automation:start', {
      repositoryId: target.repositoryId,
      worktreePath: target.worktreePath,
      values: target.values,
      startIndex
    }).then(setRunId)
  }

  useEffect(() => {
    if (!target) return
    void invoke('automation:start', {
      repositoryId: target.repositoryId,
      worktreePath: target.worktreePath,
      values: target.values,
      startIndex: 0
    }).then(setRunId)
  }, [target])

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

        <ConsoleOutput commands={commands} />

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
