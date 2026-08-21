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

export interface PresetRun {
  presetName: string
  runId: string
}

/**
 * A shell preset's command as it runs. A preset used to be a detached
 * process, which meant a command that failed did so out of sight; the same
 * console setup automation uses answers "did that work?" without leaving the
 * app.
 */
export function PresetConsole({
  run,
  onClose
}: {
  run: PresetRun | null
  onClose: () => void
}): React.JSX.Element | null {
  const { commands, status } = useAutomationRun(run?.runId ?? null)

  if (!run) return null

  const running = status === 'running'
  const heading =
    status === 'running'
      ? 'Running…'
      : status === 'completed'
        ? 'Finished'
        : status === 'cancelled'
          ? 'Cancelled'
          : 'Failed'

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !running) onClose()
      }}
    >
      <DialogContent
        data-testid="preset-console"
        className="max-w-2xl sm:max-w-2xl"
        showCloseButton={!running}
      >
        <DialogHeader>
          <DialogTitle>{run.presetName}</DialogTitle>
          <DialogDescription data-testid="preset-console-status">{heading}</DialogDescription>
        </DialogHeader>

        <ConsoleOutput commands={commands} />

        <DialogFooter>
          {running ? (
            <Button
              variant="destructive"
              onClick={() => void invoke('automation:cancel', run.runId)}
            >
              Cancel
            </Button>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
