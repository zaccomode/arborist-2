import { describe, it, expect } from 'vitest'
import { AppError } from '../../src/shared/errors'
import { execGitAt, gitEnv } from '../../src/main/services/git/git-executor'

// The executor's contract is about process handling, not about git itself, so
// these drive it with node as a stand-in for a git binary that behaves however
// the case needs.
const node = process.execPath

describe('execGitAt', () => {
  it('resolves with stdout on success', async () => {
    const result = await execGitAt(node, ['-e', 'process.stdout.write("git version 2.43.0")'])

    expect(result).toEqual({ stdout: 'git version 2.43.0', stderr: '', exitCode: 0 })
  })

  it('resolves rather than rejects on a non-zero exit', async () => {
    const result = await execGitAt(node, [
      '-e',
      'process.stderr.write("fatal: not a repository"); process.exit(128)'
    ])

    expect(result.exitCode).toBe(128)
    expect(result.stderr).toContain('fatal: not a repository')
  })

  it('kills the process and rejects with a typed timeout error', async () => {
    const started = Date.now()
    const error = await execGitAt(node, ['-e', 'setTimeout(() => {}, 30000)'], {
      timeoutMs: 200
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('git-timeout')
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('rejects with an abort error when the signal fires', async () => {
    const controller = new AbortController()
    const pending = execGitAt(node, ['-e', 'setTimeout(() => {}, 30000)'], {
      signal: controller.signal
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'git-aborted' })
  })

  it('rejects when the binary cannot be run at all', async () => {
    await expect(execGitAt('/definitely/not/git', ['--version'])).rejects.toMatchObject({
      code: 'git-unavailable'
    })
  })
})

describe('gitEnv', () => {
  it('disables credential prompts and pins the locale', () => {
    const env = gitEnv({ PATH: '/usr/bin' }, 'linux')

    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.LC_ALL).toBe('C')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('prepends the Homebrew prefixes on macOS, where a packaged app has no shell PATH', () => {
    const env = gitEnv({ PATH: '/usr/bin' }, 'darwin')

    expect(env.PATH).toBe('/usr/local/bin:/opt/homebrew/bin:/usr/bin')
  })

  it('does not duplicate a prefix already on PATH', () => {
    const env = gitEnv({ PATH: '/opt/homebrew/bin:/usr/bin' }, 'darwin')

    expect(env.PATH).toBe('/usr/local/bin:/opt/homebrew/bin:/usr/bin')
  })
})
