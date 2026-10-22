import { create } from 'zustand'
import type { SubstitutionValues } from '@shared/substitution'
import { invoke } from '@/api/client'
import { showErrorToast } from '@/lib/error-toast'
import { automationRunState, forgetAutomationRun } from '@/state/automation-run'

export interface AutomationTarget {
  repositoryId: string
  worktreePath: string
  /** What the worktree is called on screen, for the toast that reports on it. */
  label: string
  values: SubstitutionValues
}

export interface SetupRun {
  /**
   * Unique to this run of the setup, where the key is shared by every run on
   * the worktree. Each run's toast is its own, so one that has ended cannot
   * carry its countdown over onto the next.
   */
  id: number
  target: AutomationTarget
  /** Null between asking main to start the run and hearing its id back. */
  runId: string | null
}

interface SetupRunsState {
  /**
   * Keyed by worktree path: a worktree has at most one setup at a time, and a
   * retry or a second run replaces the first rather than joining it.
   */
  setups: Record<string, SetupRun>
  /** The setup whose console is on screen. Every other one is in the background. */
  shown: string | null
}

/**
 * Setup runs, including the ones nobody is watching (#88). A run outlives its
 * console: closing the console while commands are still going sends the run
 * to the background, where a toast reports on it instead.
 */
let nextId = 1

export const useSetupRuns = create<SetupRunsState>(() => ({ setups: {}, shown: null }))

function isRunning(setup: SetupRun | undefined): boolean {
  return setup !== undefined && automationRunState(setup.runId).status === 'running'
}

/** Removes a setup and the output it collected. */
function drop(setups: Record<string, SetupRun>, key: string): Record<string, SetupRun> {
  const setup = setups[key]
  if (setup?.runId) forgetAutomationRun(setup.runId)
  const next = { ...setups }
  delete next[key]
  return next
}

/**
 * Puts one setup's console on screen. A finished setup whose console this
 * replaces is done with, since its console was the only thing still showing it.
 */
export function showSetup(key: string): void {
  useSetupRuns.setState(({ setups, shown }) => ({
    setups: shown && shown !== key && !isRunning(setups[shown]) ? drop(setups, shown) : setups,
    shown: key
  }))
}

/** Starts a setup run, or a retry of one from a given command, and shows its console. */
export function startSetup(target: AutomationTarget, startIndex = 0): void {
  const key = target.worktreePath
  const setup: SetupRun = { id: nextId++, target, runId: null }
  useSetupRuns.setState(({ setups }) => ({ setups: { ...drop(setups, key), [key]: setup } }))
  showSetup(key)

  invoke('automation:start', {
    repositoryId: target.repositoryId,
    worktreePath: target.worktreePath,
    values: target.values,
    startIndex
  }).then(
    (runId) =>
      useSetupRuns.setState(({ setups }) =>
        // Unless something replaced it while the request was in flight.
        setups[key] === setup ? { setups: { ...setups, [key]: { ...setup, runId } } } : {}
      ),
    (cause: Error) => {
      forgetSetup(key)
      showErrorToast('Could not start setup', { description: cause.message })
    }
  )
}

/**
 * Runs a worktree's setup. One already running on that worktree is brought
 * back into view instead, since two at once would fight over the same files.
 */
export function runSetup(target: AutomationTarget): void {
  const key = target.worktreePath
  if (isRunning(useSetupRuns.getState().setups[key])) showSetup(key)
  else startSetup(target)
}

/**
 * Closes the console on screen. A run still going carries on in the
 * background; a finished one has nothing left to show, so it goes.
 */
export function closeSetupConsole(): void {
  useSetupRuns.setState(({ setups, shown }) => ({
    setups: shown && !isRunning(setups[shown]) ? drop(setups, shown) : setups,
    shown: null
  }))
}

/**
 * Forgets a setup, for a result toast that closed. `id` names the run the
 * toast was about, so a late close cannot take a newer run with it.
 */
export function forgetSetup(key: string, id?: number): void {
  useSetupRuns.setState(({ setups, shown }) => {
    const setup = setups[key]
    if (!setup || (id !== undefined && setup.id !== id)) return {}
    return { setups: drop(setups, key), shown: shown === key ? null : shown }
  })
}
