import { describe, it, expect, vi } from 'vitest'
import { GitService } from '../../src/main/services/git/git-service'
import type { GitRunner } from '../../src/main/services/git/git-runner'
import type { GitExecResult } from '../../src/main/services/git/git-executor'

function fakeRunner(result: Partial<GitExecResult> & { exitCode: number }): GitRunner {
  const run = vi
    .fn()
    .mockResolvedValue({ stdout: '', stderr: '', ...result } satisfies GitExecResult)
  return { run } as unknown as GitRunner
}

describe('GitService.fetchAll', () => {
  it('resolves when the fetch succeeds', async () => {
    const service = new GitService(fakeRunner({ exitCode: 0 }))
    await expect(service.fetchAll('/repo')).resolves.toBeUndefined()
  })

  it('rewrites an authentication failure into a friendly message, per the one sanctioned stderr match', async () => {
    const service = new GitService(
      fakeRunner({
        exitCode: 128,
        stderr: 'fatal: Authentication failed for https://example.invalid/x'
      })
    )
    await expect(service.fetchAll('/repo')).rejects.toThrow(
      'Arborist uses your system git credentials'
    )
  })

  it('recognises the terminal-prompt failure GIT_TERMINAL_PROMPT=0 produces in place of a real prompt', async () => {
    const service = new GitService(
      fakeRunner({
        exitCode: 128,
        stderr:
          "fatal: could not read Username for 'https://example.invalid': terminal prompts disabled"
      })
    )
    await expect(service.fetchAll('/repo')).rejects.toThrow(
      'Arborist uses your system git credentials'
    )
  })

  it('leaves an unrelated failure as git reported it', async () => {
    const service = new GitService(
      fakeRunner({ exitCode: 128, stderr: 'fatal: repository not found' })
    )
    await expect(service.fetchAll('/repo')).rejects.toThrow('repository not found')
  })

  it('coalesces two concurrent calls on the same repository into one underlying run', async () => {
    const runner = fakeRunner({ exitCode: 0 })
    const service = new GitService(runner)

    await Promise.all([service.fetchAll('/repo'), service.fetchAll('/repo')])

    expect(runner.run).toHaveBeenCalledTimes(1)
  })

  it('does not coalesce fetches on different repositories', async () => {
    const runner = fakeRunner({ exitCode: 0 })
    const service = new GitService(runner)

    await Promise.all([service.fetchAll('/repo-a'), service.fetchAll('/repo-b')])

    expect(runner.run).toHaveBeenCalledTimes(2)
  })

  it('allows a fresh fetch once the previous one has settled', async () => {
    const runner = fakeRunner({ exitCode: 0 })
    const service = new GitService(runner)

    await service.fetchAll('/repo')
    await service.fetchAll('/repo')

    expect(runner.run).toHaveBeenCalledTimes(2)
  })
})
