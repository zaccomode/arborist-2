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
