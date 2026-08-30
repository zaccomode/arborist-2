import { execFile } from 'child_process'
import { AppError } from '../../../shared/errors'

export const DEFAULT_TIMEOUT_MS = 30_000
export const FETCH_TIMEOUT_MS = 120_000

/** 64 MiB: `git log` over a large repo comfortably exceeds Node's 1 MiB default. */
const MAX_BUFFER = 64 * 1024 * 1024

export interface GitExecResult {
  stdout: string
  stderr: string
  exitCode: number
  /** Filled only when `encoding: 'buffer'` was requested. */
  stdoutBuffer?: Buffer
}

export interface ExecGitOptions {
  /** Passed as `-C <repoPath>`, so git resolves the repo without a cwd change. */
  repoPath?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** Written to the child's stdin, then closed. */
  input?: string | Buffer
  /** 'utf8' (default) fills stdout/stderr; 'buffer' additionally fills stdoutBuffer. */
  encoding?: 'utf8' | 'buffer'
}

let debugEnabled = process.env['ARBORIST_DEBUG'] === '1'

export function setGitDebug(enabled: boolean): void {
  debugEnabled = enabled || process.env['ARBORIST_DEBUG'] === '1'
}

/**
 * `GIT_TERMINAL_PROMPT=0` so a repo needing credentials fails instead of
 * hanging on a prompt no one can see, and `LC_ALL=C` so the porcelain parsers
 * see one stable locale.
 *
 * A packaged macOS app is launched by the window server rather than a shell,
 * so it inherits a bare `PATH` without the Homebrew prefixes git usually
 * lives under.
 */
export function gitEnv(
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C'
  }
  if (platform === 'darwin') {
    const prefixes = ['/usr/local/bin', '/opt/homebrew/bin']
    const existing = base.PATH ?? ''
    const missing = prefixes.filter((p) => !existing.split(':').includes(p))
    env.PATH = [...missing, existing].filter(Boolean).join(':')
  }
  return env
}

interface ExecFileError extends Error {
  code?: number | string
  killed?: boolean
  signal?: NodeJS.Signals | null
}

/**
 * Spawn failures that say "this machine could not start a process just now"
 * rather than "there is no git here": the file-descriptor and process-table
 * exhaustion errnos. Watching a large monorepo holds thousands of
 * descriptors open, and a refresh over it asks for a burst of git processes
 * on top, each needing three more pipes — enough, on a machine whose limit
 * is low enough, to run the app out mid-spawn.
 *
 * `EBADF` is the awkward one, and the reason this list exists at all (#75).
 * `ChildProcess.prototype.spawn` routes `EACCES`, `EAGAIN`, `EMFILE`,
 * `ENFILE` and `ENOENT` through an asynchronous error event, so those reach
 * `execFile`'s callback and get typed below like any other failure. Every
 * other errno — `EBADF` among them — is thrown *synchronously*, out of the
 * `execFile` call itself. Unwrapped, that escaped this promise's executor
 * entirely and surfaced in the renderer as a bare `spawn EBADF` with none of
 * this app's own framing, which is exactly what #75 reported.
 */
const TRANSIENT_SPAWN_CODES: readonly string[] = ['EBADF', 'EMFILE', 'ENFILE', 'EAGAIN']

/** How long to wait before the single retry a transient spawn failure gets. */
const SPAWN_RETRY_DELAY_MS = 150

/** The code `execGitAt` throws for a `TRANSIENT_SPAWN_CODES` failure. */
export const SPAWN_FAILED_CODE = 'git-spawn-failed'

/**
 * Whether a spawn failure is one worth trying again. Exported for its own
 * test: the condition it describes is a machine-wide resource state, which
 * a test can't provoke on demand without also destabilising the runner.
 */
export function isTransientSpawnCode(code: unknown): boolean {
  return typeof code === 'string' && TRANSIENT_SPAWN_CODES.includes(code)
}

function spawnFailure(gitPath: string, error: ExecFileError): AppError {
  return new AppError(
    `Could not start git at ${gitPath}: ${error.message}. This machine is out of ` +
      'file descriptors or processes — close some applications and try again.',
    SPAWN_FAILED_CODE
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Runs git as `gitPath` with an argv array — never a shell string, so branch
 * names and paths need no quoting and injection is not expressible.
 *
 * Resolves on a non-zero exit; only failing to run git at all, a timeout, or
 * an abort reject.
 *
 * A transient spawn failure (see `TRANSIENT_SPAWN_CODES`) is retried once,
 * after a short pause. One retry rather than a backoff loop: the burst that
 * exhausted the descriptors is the app's own refresh, so the pause is enough
 * for the sibling processes to exit and hand theirs back, and a machine that
 * still cannot spawn after that has a problem no amount of waiting here will
 * fix. The second failure propagates as a typed `AppError` and is reported.
 */
export async function execGitAt(
  gitPath: string,
  args: readonly string[],
  options: ExecGitOptions = {}
): Promise<GitExecResult> {
  try {
    return await execGitOnce(gitPath, args, options)
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== SPAWN_FAILED_CODE) throw error
    await delay(SPAWN_RETRY_DELAY_MS)
    return execGitOnce(gitPath, args, options)
  }
}

function execGitOnce(
  gitPath: string,
  args: readonly string[],
  options: ExecGitOptions = {}
): Promise<GitExecResult> {
  const argv = options.repoPath ? ['-C', options.repoPath, ...args] : [...args]
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (debugEnabled) {
    console.debug(`[git] ${gitPath} ${argv.join(' ')}`)
  }

  const raw = options.encoding === 'buffer'

  return new Promise((resolve, reject) => {
    const execOptions = {
      env: gitEnv(),
      timeout: timeoutMs,
      signal: options.signal,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: raw ? ('buffer' as const) : ('utf8' as const)
    }

    const onSettled = (
      error: Error | null,
      stdoutRaw: string | Buffer,
      stderrRaw: string | Buffer
    ): void => {
      const stdoutBuffer = raw ? (stdoutRaw as unknown as Buffer) : undefined
      const stdout = raw ? (stdoutRaw as unknown as Buffer).toString('utf8') : (stdoutRaw as string)
      const stderr = raw ? (stderrRaw as unknown as Buffer).toString('utf8') : (stderrRaw as string)

      if (!error) {
        resolve({ stdout, stderr, exitCode: 0, stdoutBuffer })
        return
      }

      const failure = error as ExecFileError
      if (failure.name === 'AbortError' || failure.code === 'ABORT_ERR') {
        reject(new AppError(`git ${args[0] ?? ''} was cancelled`.trim(), 'git-aborted'))
        return
      }
      if (failure.killed) {
        reject(
          new AppError(`git ${args[0] ?? ''} timed out after ${timeoutMs}ms`.trim(), 'git-timeout')
        )
        return
      }
      if (typeof failure.code === 'number') {
        resolve({ stdout, stderr, exitCode: failure.code, stdoutBuffer })
        return
      }
      if (isTransientSpawnCode(failure.code)) {
        reject(spawnFailure(gitPath, failure))
        return
      }
      reject(new AppError(`Failed to run git at ${gitPath}: ${failure.message}`, 'git-unavailable'))
    }

    // `execFile` itself throws for every spawn errno outside the handful
    // `ChildProcess.prototype.spawn` reports asynchronously — see
    // `TRANSIENT_SPAWN_CODES`. Unwrapped, that throw leaves this executor
    // rather than this promise, so nothing below ever runs and nothing above
    // ever types it.
    let child: ReturnType<typeof execFile>
    try {
      child = execFile(gitPath, argv, execOptions, onSettled)
    } catch (error) {
      const failure = error as ExecFileError
      reject(
        isTransientSpawnCode(failure.code)
          ? spawnFailure(gitPath, failure)
          : new AppError(`Failed to run git at ${gitPath}: ${failure.message}`, 'git-unavailable')
      )
      return
    }

    // Close stdin immediately when there's no input: a command that reads
    // stdin (`git apply` with no file argument does) otherwise hangs until
    // the timeout with no signal that anything is wrong.
    if (options.input !== undefined) {
      child.stdin?.end(options.input)
    } else {
      child.stdin?.end()
    }
  })
}
