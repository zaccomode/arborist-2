import { spawn, execFile, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { AppError } from '../../shared/errors'
import { automationCommands, type AutomationEvent } from '../../shared/automation'
import { substitute, type SubstitutionValues } from '../../shared/substitution'
import type { Settings } from '../../shared/persisted'

export interface AutomationRequest {
  script: string
  /** The new worktree: every command runs with this as its cwd. */
  worktreePath: string
  values: SubstitutionValues
  /** Resume from a command that failed, rather than starting over. */
  startIndex?: number
}

interface Run {
  runId: string
  child: ChildProcess | null
  cancelled: boolean
}

/** Command line for one automation line, per platform and settings. */
export function shellInvocation(
  command: string,
  settings: Settings,
  platform: NodeJS.Platform = process.platform
): { file: string; args: string[] } {
  if (settings.customShellPath) {
    return { file: settings.customShellPath, args: [...settings.customShellArgs, command] }
  }
  if (platform === 'win32') {
    return settings.automationShell === 'cmd'
      ? { file: 'cmd', args: ['/c', command] }
      : { file: 'powershell', args: ['-NoProfile', '-Command', command] }
  }
  // A login shell, because the tools these scripts call (nvm-managed node,
  // Homebrew binaries) are on a PATH that only a login shell sets up.
  return { file: '/bin/bash', args: ['-l', '-c', command] }
}

/**
 * Runs a project's setup script command by command, streaming everything it
 * produces, and stopping at the first failure.
 */
export class AutomationRunner {
  #emit: (event: AutomationEvent) => void
  #settings: () => Settings
  #runs = new Map<string, Run>()

  constructor(emit: (event: AutomationEvent) => void, settings: () => Settings) {
    this.#emit = emit
    this.#settings = settings
  }

  start(request: AutomationRequest): string {
    const runId = randomUUID()
    this.#runs.set(runId, { runId, child: null, cancelled: false })
    void this.#run(runId, request)
    return runId
  }

  cancel(runId: string): void {
    const run = this.#runs.get(runId)
    if (!run) return
    run.cancelled = true
    if (run.child?.pid) killTree(run.child.pid)
  }

  async #run(runId: string, request: AutomationRequest): Promise<void> {
    const run = this.#runs.get(runId)
    if (!run) return

    const commands = automationCommands(request.script)
    const startIndex = request.startIndex ?? 0
    this.#emit({ type: 'started', runId, commands, startIndex })

    const settings = this.#settings()
    const shellMode = process.platform === 'win32' ? 'powershell' : 'posix'

    for (let index = startIndex; index < commands.length; index++) {
      if (run.cancelled) break

      const command = substitute(commands[index], request.values, shellMode)
      this.#emit({ type: 'command-started', runId, index, command })

      const exitCode = await this.#runCommand(run, index, command, request.worktreePath, settings)

      if (run.cancelled) break
      this.#emit({ type: 'command-finished', runId, index, exitCode })
      if (exitCode !== 0) {
        this.#emit({ type: 'finished', runId, status: 'failed', failedIndex: index })
        this.#runs.delete(runId)
        return
      }
    }

    this.#emit({
      type: 'finished',
      runId,
      status: run.cancelled ? 'cancelled' : 'completed',
      failedIndex: null
    })
    this.#runs.delete(runId)
  }

  #runCommand(
    run: Run,
    index: number,
    command: string,
    cwd: string,
    settings: Settings
  ): Promise<number> {
    const { file, args } = shellInvocation(command, settings)

    return new Promise((resolve) => {
      // Detached so the child leads its own process group: cancelling has to
      // take the grandchildren with it, and an `npm install` has plenty.
      const child = spawn(file, args, {
        cwd,
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: { ...process.env }
      })
      run.child = child

      child.stdout?.on('data', (chunk: Buffer) =>
        this.#emit({
          type: 'output',
          runId: run.runId,
          index,
          stream: 'stdout',
          chunk: chunk.toString()
        })
      )
      child.stderr?.on('data', (chunk: Buffer) =>
        this.#emit({
          type: 'output',
          runId: run.runId,
          index,
          stream: 'stderr',
          chunk: chunk.toString()
        })
      )
      child.on('error', (error) => {
        this.#emit({
          type: 'output',
          runId: run.runId,
          index,
          stream: 'stderr',
          chunk: `${error.message}\n`
        })
        run.child = null
        resolve(127)
      })
      child.on('close', (code) => {
        run.child = null
        resolve(code ?? 1)
      })
    })
  }
}

/**
 * Kills the whole tree. A plain `kill` leaves the grandchildren running —
 * killing an `npm install` that way orphans everything it spawned.
 */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, () => {})
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      throw new AppError(`Could not stop process ${pid}.`, 'automation-cancel-failed')
    }
  }
}
