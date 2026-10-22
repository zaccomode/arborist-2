import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { ChevronRight, CircleCheckIcon, Loader2Icon, OctagonXIcon, XIcon } from 'lucide-react'
import { describeRun, EMPTY_RUN, setupToastKind, type SetupToastKind } from '@shared/automation'
import { useAllAutomationRuns } from '@/state/automation-run'
import { forgetSetup, showSetup, useSetupRuns, type SetupRun } from '@/state/setup-runs'

/** How long a success stays up. A failure stays until it is dealt with. */
const SUCCESS_DURATION = 6000

function title(kind: Exclude<SetupToastKind, 'none'>, setup: SetupRun): string {
  const name = setup.target.label
  switch (kind) {
    case 'running':
      return `Setting up ${name}`
    case 'completed':
      return `Setup finished on ${name}`
    case 'failed':
      return `Setup failed on ${name}`
  }
}

/**
 * A setup toast, drawn whole rather than through Sonner's own layout: the
 * entire toast opens the console (#88), and Sonner has no click handler for a
 * toast, only for the small action button inside one. It borrows the
 * `<Toaster>`'s own variables so it still looks like its neighbours.
 */
function SetupToast({
  kind,
  title,
  description,
  onOpen,
  onDismiss
}: {
  kind: Exclude<SetupToastKind, 'none'>
  title: string
  description: string
  onOpen: () => void
  onDismiss?: () => void
}): React.JSX.Element {
  return (
    <div
      data-testid="setup-toast"
      className="flex w-(--width) items-center rounded-(--border-radius) border border-(--normal-border) bg-(--normal-bg) text-[13px] text-(--normal-text) shadow-[0_4px_12px_#0000001a]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-(--border-radius) p-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {kind === 'running' && <Loader2Icon className="size-4 shrink-0 animate-spin" />}
        {kind === 'completed' && <CircleCheckIcon className="size-4 shrink-0" />}
        {kind === 'failed' && <OctagonXIcon className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate">{description}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="mr-2 rounded-sm p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  )
}

/**
 * Reports on setup runs in the background (#88): a toast that follows a run
 * while it goes, opens its console when clicked, and says how it ended if it
 * ended out of sight.
 */
export function SetupToasts(): null {
  const setups = useSetupRuns((state) => state.setups)
  const shown = useSetupRuns((state) => state.shown)
  const runs = useAllAutomationRuns()
  // Toast id → what that toast last said, so an unrelated change (another
  // run's output) does not redraw it, and a redraw does not restart a
  // success's countdown.
  const drawn = useRef(new Map<string, string>())

  useEffect(() => {
    const live = new Set<string>()

    for (const [key, setup] of Object.entries(setups)) {
      const run = (setup.runId ? runs[setup.runId] : undefined) ?? EMPTY_RUN
      const kind = setupToastKind(run.status, shown === key)
      if (kind === 'none') continue

      const id = `setup:${setup.id}`
      live.add(id)
      const description = describeRun(run)
      const signature = `${kind}:${description}`
      if (drawn.current.get(id) === signature) continue
      drawn.current.set(id, signature)

      toast.custom(
        () => (
          <SetupToast
            kind={kind}
            title={title(kind, setup)}
            description={description}
            onOpen={() => showSetup(key)}
            onDismiss={kind === 'failed' ? () => forgetSetup(key, setup.id) : undefined}
          />
        ),
        {
          id,
          duration: kind === 'completed' ? SUCCESS_DURATION : Infinity,
          onAutoClose: () => forgetSetup(key, setup.id)
        }
      )
    }

    for (const id of drawn.current.keys()) {
      if (live.has(id)) continue
      drawn.current.delete(id)
      toast.dismiss(id)
    }
  }, [setups, shown, runs])

  return null
}
