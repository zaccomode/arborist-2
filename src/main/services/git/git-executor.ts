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
 * Runs git as `gitPath` with an argv array — never a shell string, so branch
 * names and paths need no quoting and injection is not expressible.
 *
 * Resolves on a non-zero exit; only failing to run git at all, a timeout, or
 * an abort reject.
 */
export function execGitAt(
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
    const child = execFile(
      gitPath,
      argv,
      {
        env: gitEnv(),
        timeout: timeoutMs,
        signal: options.signal,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        encoding: raw ? 'buffer' : 'utf8'
      },
      (error, stdoutRaw, stderrRaw) => {
        const stdoutBuffer = raw ? (stdoutRaw as unknown as Buffer) : undefined
        const stdout = raw
          ? (stdoutRaw as unknown as Buffer).toString('utf8')
          : (stdoutRaw as string)
        const stderr = raw
          ? (stderrRaw as unknown as Buffer).toString('utf8')
          : (stderrRaw as string)

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
            new AppError(
              `git ${args[0] ?? ''} timed out after ${timeoutMs}ms`.trim(),
              'git-timeout'
            )
          )
          return
        }
        if (typeof failure.code === 'number') {
          resolve({ stdout, stderr, exitCode: failure.code, stdoutBuffer })
          return
        }
        reject(
          new AppError(`Failed to run git at ${gitPath}: ${failure.message}`, 'git-unavailable')
        )
      }
    )

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
