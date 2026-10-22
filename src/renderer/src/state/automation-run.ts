import { create } from 'zustand'
import {
  applyAutomationEvent,
  EMPTY_RUN,
  type AutomationEvent,
  type RunState
} from '@shared/automation'

interface AutomationRunsState {
  /** Run id → everything heard about that run so far. */
  runs: Record<string, RunState>
  apply: (event: AutomationEvent) => void
  /** Drops a run nobody will look at again, since its output can be large. */
  forget: (runId: string) => void
}

const useAutomationRuns = create<AutomationRunsState>((set) => ({
  runs: {},
  apply: (event) =>
    set((state) => ({
      runs: {
        ...state.runs,
        [event.runId]: applyAutomationEvent(state.runs[event.runId] ?? EMPTY_RUN, event)
      }
    })),
  forget: (runId) =>
    set((state) => {
      const runs = { ...state.runs }
      delete runs[runId]
      return { runs }
    })
}))

// One subscription for the life of the window, rather than one per console.
// A setup run carries on after its console closes (#88), and main sends a
// run's first events before `automation:start` has even returned its id, so
// anything listening only while a console is open would miss both.
window.arborist.subscribe('automation:event', (event: AutomationEvent) =>
  useAutomationRuns.getState().apply(event)
)

/**
 * The live state of one automation run. Shared by the setup console and the
 * console a shell preset opens, because a preset command is a one-line script
 * through the same runner. `null` is a run whose id has not arrived yet.
 */
export function useAutomationRun(runId: string | null): RunState {
  return useAutomationRuns((state) => (runId ? state.runs[runId] : undefined)) ?? EMPTY_RUN
}

export function forgetAutomationRun(runId: string): void {
  useAutomationRuns.getState().forget(runId)
}

/** The same, read once outside React. */
export function automationRunState(runId: string | null): RunState {
  return (runId ? useAutomationRuns.getState().runs[runId] : undefined) ?? EMPTY_RUN
}

/** Every run's state, for whatever reports on runs nobody is looking at. */
export function useAllAutomationRuns(): Record<string, RunState> {
  return useAutomationRuns((state) => state.runs)
}
