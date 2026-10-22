import { describeRun } from '@shared/automation'
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
import { closeSetupConsole, startSetup, useSetupRuns } from '@/state/setup-runs'
import { invoke } from '@/api/client'

/**
 * Live output from whichever setup run is on screen. Closing it while
 * commands are still running sends the run to the background rather than
 * stopping it (#88): cancelling is a decision, and closing the window is not
 * the same thing as making it.
 */
export function AutomationConsole(): React.JSX.Element | null {
  const setup = useSetupRuns((state) => (state.shown ? state.setups[state.shown] : undefined))
  const run = useAutomationRun(setup?.runId ?? null)

  if (!setup) return null

  const running = run.status === 'running'

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) closeSetupConsole()
      }}
    >
      <DialogContent data-testid="automation-console" className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Setup automation</DialogTitle>
          <DialogDescription data-testid="automation-status">{describeRun(run)}</DialogDescription>
        </DialogHeader>

        <ConsoleOutput commands={run.commands} />

        <DialogFooter>
          {running ? (
            <>
              <Button
                variant="destructive"
                disabled={!setup.runId}
                onClick={() => setup.runId && void invoke('automation:cancel', setup.runId)}
              >
                Cancel
              </Button>
              <Button variant="outline" onClick={closeSetupConsole}>
                Run in background
              </Button>
            </>
          ) : (
            <>
              {run.failedIndex !== null && (
                <Button
                  variant="outline"
                  onClick={() => startSetup(setup.target, run.failedIndex ?? 0)}
                >
                  Retry from failed
                </Button>
              )}
              <Button variant="outline" onClick={() => startSetup(setup.target)}>
                Run again
              </Button>
              <Button onClick={closeSetupConsole}>Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
