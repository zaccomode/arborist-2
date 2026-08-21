import { useEffect, useState } from 'react'
import type { AutomationEvent, AutomationStatus } from '@shared/automation'

export interface CommandState {
  command: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  output: string
}

export interface RunState {
  commands: CommandState[]
  status: AutomationStatus
  /** Which command stopped the run, for the retry offer. */
  failedIndex: number | null
}

/**
 * The live state of one automation run, assembled from the events main
 * pushes. Shared by the setup console and the console a shell preset opens,
 * because a preset command is a one-line script through the same runner.
 *
 * `runId` arrives after the run has started, so events that land before it
 * are accepted rather than dropped — only one run is ever in flight.
 */
export function useAutomationRun(runId: string | null): RunState {
  const [commands, setCommands] = useState<CommandState[]>([])
  const [status, setStatus] = useState<AutomationStatus>('running')
  const [failedIndex, setFailedIndex] = useState<number | null>(null)
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

    // Re-subscribed whenever the run changes, so a retry's events are matched
    // against the run that is actually current.
    return window.arborist.subscribe('automation:event', (event: AutomationEvent) => {
      if (runId && event.runId !== runId) return
      applyEvent(event)
    })
  }, [runId])

  return { commands, status, failedIndex }
}
