/**
 * Setup automation, as v1 defined it and this rewrite keeps it.
 *
 * The script looks like a shell script but isn't one: every non-blank line
 * that isn't a comment is an independent command, run in order with the new
 * worktree as its working directory. A `cd` on line one does not affect line
 * two, and multi-line constructs do not work.
 *
 * That is a real limitation, and the editor says so. It is also what makes
 * per-command progress, stopping at the first failure, and retrying from the
 * command that failed possible at all.
 */

export interface ScriptLine {
  /** Index within the file, so a message can name the line the user sees. */
  lineNumber: number
  raw: string
  /** Null for a blank or comment line, which is skipped rather than run. */
  command: string | null
}

export function parseAutomationScript(script: string): ScriptLine[] {
  return script.split(/\r?\n/).map((raw, index) => {
    const trimmed = raw.trim()
    const skipped = trimmed.length === 0 || trimmed.startsWith('#')
    return { lineNumber: index + 1, raw, command: skipped ? null : trimmed }
  })
}

/** Just the commands, in run order. */
export function automationCommands(script: string): string[] {
  return parseAutomationScript(script)
    .map((line) => line.command)
    .filter((command): command is string => command !== null)
}

export type AutomationStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type AutomationEvent =
  | { type: 'started'; runId: string; commands: string[]; startIndex: number }
  | { type: 'command-started'; runId: string; index: number; command: string }
  | { type: 'output'; runId: string; index: number; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'command-finished'; runId: string; index: number; exitCode: number }
  | {
      type: 'finished'
      runId: string
      status: Exclude<AutomationStatus, 'running'>
      failedIndex: number | null
    }

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

/** A run nothing has been heard from yet: running, with no commands. */
export const EMPTY_RUN: RunState = { commands: [], status: 'running', failedIndex: null }

/**
 * Folds one event from main into the state of the run it belongs to. Pure, so
 * the renderer can keep every run's state in one place whether or not a
 * console is showing it.
 */
export function applyAutomationEvent(state: RunState, event: AutomationEvent): RunState {
  const updateCommand = (
    index: number,
    update: (entry: CommandState) => CommandState
  ): RunState => ({
    ...state,
    commands: state.commands.map((entry, at) => (at === index ? update(entry) : entry))
  })

  switch (event.type) {
    case 'started':
      return {
        status: 'running',
        failedIndex: null,
        commands: event.commands.map((command, index) => ({
          command,
          status: index < event.startIndex ? 'skipped' : 'pending',
          output: ''
        }))
      }
    case 'command-started':
      // The substituted form, which is what actually ran.
      return updateCommand(event.index, (entry) => ({
        ...entry,
        command: event.command,
        status: 'running',
        output: ''
      }))
    case 'output':
      return updateCommand(event.index, (entry) => ({
        ...entry,
        output: entry.output + event.chunk
      }))
    case 'command-finished':
      return updateCommand(event.index, (entry) => ({
        ...entry,
        status: event.exitCode === 0 ? 'succeeded' : 'failed'
      }))
    case 'finished':
      return { ...state, status: event.status, failedIndex: event.failedIndex }
  }
}

/** One line on where a run has got to, for the console's heading and the toast. */
export function describeRun({ commands, status, failedIndex }: RunState): string {
  switch (status) {
    case 'running': {
      if (commands.length === 0) return 'Starting…'
      const finished = commands.filter((entry) => entry.status === 'succeeded').length
      return `Running ${Math.min(finished + 1, commands.length)} of ${commands.length}`
    }
    case 'completed':
      return `Completed ${commands.length} commands`
    case 'cancelled':
      return 'Cancelled'
    case 'failed':
      return `Failed at command ${(failedIndex ?? 0) + 1}`
  }
}

/** What a setup run that is out of sight should say about itself. */
export type SetupToastKind = 'none' | 'running' | 'completed' | 'failed'

/**
 * Whether a setup run needs a toast, and which. A console on screen already
 * shows everything, so a visible run never has one. A cancelled run needs no
 * news: cancelling happens in the console, so whoever did it already knows.
 */
export function setupToastKind(status: AutomationStatus, visible: boolean): SetupToastKind {
  if (visible || status === 'cancelled') return 'none'
  return status
}
