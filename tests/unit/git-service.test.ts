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

/** A `GitRunner` whose response depends on the args it was called with. */
function fakeGit(
  responder: (args: readonly string[]) => Partial<GitExecResult> & { exitCode: number }
): GitRunner {
  const build = (args: readonly string[]): GitExecResult => ({
    stdout: '',
    stderr: '',
    ...responder(args)
  })
  const run = vi.fn(async (args: readonly string[]) => build(args))
  const runOrThrow = vi.fn(async (args: readonly string[]) => {
    const result = build(args)
    if (result.exitCode !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
    return result
  })
  return { run, runOrThrow } as unknown as GitRunner
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

describe('GitService.listRemoteBranches', () => {
  it('hides a remote branch that already has a local worktree, matching by short name', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'branch') {
          return { exitCode: 0, stdout: 'origin/HEAD\norigin/main\norigin/feature-x\n' }
        }
        if (args[0] === 'worktree') {
          return { exitCode: 0, stdout: 'worktree /repo\nHEAD aaa\nbranch refs/heads/feature-x\n' }
        }
        if (args[0] === 'log') return { exitCode: 0, stdout: '' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const branches = await service.listRemoteBranches('/repo')

    expect(branches.map((branch) => branch.name)).toEqual(['origin/main'])
  })

  it('reads the tip commit for each surviving candidate', async () => {
    const commitLine = ['aaa', 'aaa1234', 'Isaac Shea', '2026-08-20T14:00:00Z', 'Subject'].join(
      '\u0000'
    )
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'branch') return { exitCode: 0, stdout: 'origin/feature-y\n' }
        if (args[0] === 'worktree') return { exitCode: 0, stdout: '' }
        if (args[0] === 'log') return { exitCode: 0, stdout: commitLine }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const [branch] = await service.listRemoteBranches('/repo')

    expect(branch).toMatchObject({ name: 'origin/feature-y', shortName: 'feature-y' })
    expect(branch.lastCommit).toMatchObject({ subject: 'Subject', shortHash: 'aaa1234' })
  })
})

describe('GitService.createWorktree, tracking a remote branch', () => {
  it('runs worktree add --track -b <branch> <path> <baseRef>', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'show-ref') return { exitCode: 1 }
        return { exitCode: 0, stdout: '' }
      })
    )

    await service.createWorktree('/repo', {
      branch: 'feature-x',
      path: '/tmp/arborist-unit-test-nonexistent-path',
      baseRef: 'origin/feature-x',
      track: true
    })

    expect(calls.find((call) => call[0] === 'worktree')).toEqual([
      'worktree',
      'add',
      '--track',
      '-b',
      'feature-x',
      '/tmp/arborist-unit-test-nonexistent-path',
      'origin/feature-x'
    ])
  })
})
