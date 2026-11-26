import { describe, it, expect, vi } from 'vitest'
import { GitService } from '../../src/main/services/git/git-service'
import type { GitRunner } from '../../src/main/services/git/git-runner'
import type { GitExecResult } from '../../src/main/services/git/git-executor'
import { normaliseGitPath } from '../../src/shared/paths'

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

  it('passes the caller through to the sign-in environment (#185)', async () => {
    const callers: string[] = []
    const service = new GitService(
      fakeRunner({ exitCode: 0 }),
      () => {},
      async (_repoPath, caller) => {
        callers.push(caller)
        return undefined
      }
    )

    await service.fetchAll('/repo', 'user')
    await service.fetchAll('/repo', 'background')
    await service.fetchAll('/repo')

    expect(callers).toEqual(['user', 'background', 'background'])
  })

  describe('a user fetch arriving during a background fetch (#185)', () => {
    /**
     * A service whose first fetch blocks until `release` is called. Its first
     * `failures` git runs fail as `firstFails` asks (an auth failure for
     * `true`, or the given stderr) and later ones succeed at once. A caller
     * for whom `signedIn` holds is given the sign-in's environment.
     * `running` counts git processes alive at the same time.
     */
    function blockedService(
      firstFails: boolean | string,
      signedIn: (caller: string) => boolean = () => false,
      failures = 1
    ): {
      service: GitService
      release: () => void
      callers: string[]
      run: ReturnType<typeof vi.fn>
      maxRunning: () => number
    } {
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const callers: string[] = []
      let running = 0
      let maxRunning = 0
      let calls = 0
      const run = vi.fn(async (): Promise<GitExecResult> => {
        const index = ++calls
        const first = index === 1
        running++
        maxRunning = Math.max(maxRunning, running)
        if (first) await gate
        running--
        if (index > failures || !firstFails) return { stdout: '', stderr: '', exitCode: 0 }
        const stderr =
          typeof firstFails === 'string' ? firstFails : 'fatal: could not read Username'
        return { stdout: '', stderr, exitCode: 128 }
      })
      const service = new GitService(
        { run } as unknown as GitRunner,
        () => {},
        async (_repoPath, caller) => {
          callers.push(caller)
          return signedIn(caller) ? { GIT_CONFIG_COUNT: '0' } : undefined
        }
      )
      return { service, release, callers, run, maxRunning: () => maxRunning }
    }

    it('runs a user fetch after the background one fails, never alongside it', async () => {
      const { service, release, callers, run, maxRunning } = blockedService(true)
      const background = service.fetchAll('/repo', 'background')
      const user = service.fetchAll('/repo', 'user')
      const secondUser = service.fetchAll('/repo', 'user')
      await Promise.resolve()
      expect(run).toHaveBeenCalledTimes(1)

      release()
      await expect(background).rejects.toMatchObject({ code: 'fetch-auth-failed' })
      await expect(user).resolves.toBeUndefined()
      await expect(secondUser).resolves.toBeUndefined()

      // Both user callers share the one retry, which waited for the sign-in.
      expect(callers).toEqual(['background', 'user'])
      expect(run).toHaveBeenCalledTimes(2)
      expect(maxRunning()).toBe(1)
    })

    it('passes on a network failure without fetching again (#188)', async () => {
      const { service, release, callers, run } = blockedService(
        "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com"
      )
      const background = service.fetchAll('/repo', 'background')
      const user = service.fetchAll('/repo', 'user')
      release()

      await expect(background).rejects.toMatchObject({ code: 'git-command-failed' })
      await expect(user).rejects.toMatchObject({
        code: 'git-command-failed',
        message: expect.stringContaining('Could not resolve host')
      })
      expect(callers).toEqual(['background'])
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('passes on an auth failure from a fetch that already had the sign-in (#188)', async () => {
      // The token was sent and refused, then the fallback without it failed
      // too: waiting for the same sign-in would change nothing.
      const { service, release, callers, run } = blockedService(
        'remote: Permission to o/r.git denied.\nfatal: unable to access: The requested URL returned error: 403',
        () => true,
        2
      )
      const background = service.fetchAll('/repo', 'background')
      const user = service.fetchAll('/repo', 'user')
      release()

      await expect(background).rejects.toMatchObject({ code: 'fetch-auth-failed' })
      await expect(user).rejects.toMatchObject({ code: 'fetch-auth-failed' })
      expect(callers).toEqual(['background'])
      expect(run).toHaveBeenCalledTimes(2)
    })

    it('shares the background fetch when it succeeds', async () => {
      const { service, release, callers, run } = blockedService(false)
      const background = service.fetchAll('/repo', 'background')
      const user = service.fetchAll('/repo', 'user')
      release()
      await Promise.all([background, user])

      expect(callers).toEqual(['background'])
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('lets a background caller join a running user fetch', async () => {
      const { service, release, callers, run } = blockedService(false)
      const user = service.fetchAll('/repo', 'user')
      const background = service.fetchAll('/repo', 'background')
      release()
      await Promise.all([user, background])

      expect(callers).toEqual(['user'])
      expect(run).toHaveBeenCalledTimes(1)
    })
  })

  it('allows a fresh fetch once the previous one has settled', async () => {
    const runner = fakeRunner({ exitCode: 0 })
    const service = new GitService(runner)

    await service.fetchAll('/repo')
    await service.fetchAll('/repo')

    expect(runner.run).toHaveBeenCalledTimes(2)
  })
})

/**
 * One line of `for-each-ref --format=${REMOTE_BRANCH_FORMAT} refs/remotes`:
 * the ref's short name, then `COMMIT_FORMAT`'s five fields for its tip.
 */
function remoteRefLine(ref: string): string {
  return [ref, 'aaa', 'aaa1234', 'Isaac Shea', '2026-08-20T14:00:00Z', 'Subject'].join('\u0000')
}

/**
 * Two `for-each-ref` calls now go into a remote-branch listing — the remote
 * refs themselves and the local branches' upstreams — so the responder has to
 * tell them apart by namespace rather than by the subcommand alone.
 */
function isRemoteRefQuery(args: readonly string[]): boolean {
  return args[0] === 'for-each-ref' && args[args.length - 1] === 'refs/remotes'
}

describe('GitService.listRemoteBranches', () => {
  it('hides a remote branch that already has a local worktree, matching by short name', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (isRemoteRefQuery(args)) {
          return {
            exitCode: 0,
            stdout: [
              remoteRefLine('origin/HEAD'),
              remoteRefLine('origin/main'),
              remoteRefLine('origin/feature-x')
            ].join('\n')
          }
        }
        if (args[0] === 'worktree') {
          return { exitCode: 0, stdout: 'worktree /repo\nHEAD aaa\nbranch refs/heads/feature-x\n' }
        }
        if (args[0] === 'for-each-ref') return { exitCode: 0, stdout: 'feature-x \n' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const branches = await service.listRemoteBranches('/repo')

    expect(branches.map((branch) => branch.name)).toEqual(['origin/main'])
  })

  it('hides a remote branch whose upstream is tracked by a differently-named local branch (#47)', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (isRemoteRefQuery(args)) {
          return { exitCode: 0, stdout: remoteRefLine('origin/feature-y') }
        }
        if (args[0] === 'worktree') {
          return {
            exitCode: 0,
            stdout: 'worktree /repo/other-folder\nHEAD aaa\nbranch refs/heads/my-custom-name\n'
          }
        }
        if (args[0] === 'for-each-ref') {
          return { exitCode: 0, stdout: 'my-custom-name origin/feature-y\n' }
        }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const branches = await service.listRemoteBranches('/repo')

    expect(branches).toEqual([])
  })

  /**
   * #75: the tip commits used to come from one `git log -1` per surviving
   * candidate, which on a repository with a few thousand remote branches is a
   * few thousand process spawns per refresh — the spawn storm behind the
   * `spawn EBADF` report, and the multi-second stall alongside it. They now
   * come out of the same `for-each-ref` that produced the list.
   */
  it('reads every tip commit out of the one ref query, spawning nothing per branch', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (isRemoteRefQuery(args)) {
          return {
            exitCode: 0,
            stdout: [remoteRefLine('origin/feature-y'), remoteRefLine('origin/feature-z')].join(
              '\n'
            )
          }
        }
        if (args[0] === 'worktree') return { exitCode: 0, stdout: '' }
        if (args[0] === 'for-each-ref') return { exitCode: 0, stdout: '' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const branches = await service.listRemoteBranches('/repo')

    expect(branches).toHaveLength(2)
    expect(branches[0]).toMatchObject({ name: 'origin/feature-y', shortName: 'feature-y' })
    expect(branches[0].lastCommit).toMatchObject({ subject: 'Subject', shortHash: 'aaa1234' })
    // Three calls total, for any number of branches: the ref query, the
    // worktree list, and the local-branch upstream lookup.
    expect(calls).toHaveLength(3)
    expect(calls.some((args) => args[0] === 'log')).toBe(false)
  })
})

const FS = ' '

/** Joins status v2 records the way `-z` output does: every record NUL-terminated. */
function statusV2Output(...records: string[]): string {
  return records.map((record) => `${record}${FS}`).join('')
}

describe('GitService.planBranchSwitch', () => {
  it('refuses a branch that does not exist, without asking anything else', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'show-ref') return { exitCode: 1 }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-x')

    expect(plan).toEqual({ outcome: 'branch-missing' })
    expect(calls.some((call) => call[0] === 'worktree')).toBe(false)
  })

  it('refuses a branch already checked out in another worktree', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'show-ref') return { exitCode: 0 }
        if (args[0] === 'worktree') {
          return {
            exitCode: 0,
            stdout: [
              'worktree /repo',
              'HEAD aaa',
              'branch refs/heads/main',
              '',
              'worktree /repo-feature',
              'HEAD bbb',
              'branch refs/heads/feature-x',
              ''
            ].join('\n')
          }
        }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-x')

    // `worktree list --porcelain` always prints forward-slash paths, even on
    // Windows, and `parseWorktreeList` runs them through `normaliseGitPath`
    // (already covered directly in `tests/unit/paths.test.ts`) before this
    // code ever sees them — so the path this plan carries is in the host's
    // own native separator, not necessarily this fixture's forward-slash one.
    expect(plan).toEqual({
      outcome: 'in-use',
      path: normaliseGitPath('/repo-feature', process.platform)
    })
  })

  it('refuses when unmerged paths are present', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'show-ref') return { exitCode: 0 }
        if (args[0] === 'worktree') return { exitCode: 0, stdout: 'worktree /repo\nHEAD aaa\n' }
        if (args[0] === 'status') {
          return {
            exitCode: 0,
            stdout: statusV2Output(
              'u AA N... 000000 100644 100644 100644 ' +
                '0000000000000000000000000000000000000000 ' +
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ' +
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb conflict.txt'
            )
          }
        }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-x')

    expect(plan).toEqual({ outcome: 'unmerged' })
  })

  it('is clear with no carried changes on a clean tree, and never diffs against the branch', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'show-ref') return { exitCode: 0 }
        if (args[0] === 'worktree') return { exitCode: 0, stdout: 'worktree /repo\nHEAD aaa\n' }
        if (args[0] === 'status') return { exitCode: 0, stdout: '' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-x')

    expect(plan).toEqual({ outcome: 'clear', carriesChanges: false })
    expect(calls.some((call) => call[0] === 'diff')).toBe(false)
  })

  it('reports the conflicting paths when the branch and the dirty tree overlap', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'show-ref') return { exitCode: 0 }
        if (args[0] === 'worktree') return { exitCode: 0, stdout: 'worktree /repo\nHEAD aaa\n' }
        if (args[0] === 'status') {
          return {
            exitCode: 0,
            stdout: statusV2Output('1 .M N... 100644 100644 100644 aaa aaa a.txt')
          }
        }
        if (args[0] === 'diff') return { exitCode: 0, stdout: 'a.txt b.txt ' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-x')

    expect(plan).toEqual({ outcome: 'conflicting', paths: ['a.txt'] })
  })

  it('is clear but carries changes when the dirty tree does not overlap the branch diff', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'show-ref') return { exitCode: 0 }
        if (args[0] === 'worktree') return { exitCode: 0, stdout: 'worktree /repo\nHEAD aaa\n' }
        if (args[0] === 'status') {
          return {
            exitCode: 0,
            stdout: statusV2Output('1 .M N... 100644 100644 100644 aaa aaa a.txt')
          }
        }
        if (args[0] === 'diff') return { exitCode: 0, stdout: 'b.txt ' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-x')

    expect(plan).toEqual({ outcome: 'clear', carriesChanges: true })
  })
})

describe('GitService.switchBranch', () => {
  it('runs git switch <branch> in the worktree, and suppresses the watcher first', async () => {
    const calls: string[][] = []
    const suppressed: string[] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        return { exitCode: 0 }
      }),
      (worktreePath) => suppressed.push(worktreePath)
    )

    await service.switchBranch('/repo/feature', 'feature-x')

    expect(calls).toEqual([['switch', 'feature-x']])
    expect(suppressed).toEqual(['/repo/feature'])
  })

  it('runs git switch -c <branch> <startPoint> when creating from a given start point', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        return { exitCode: 0 }
      })
    )

    await service.switchBranch('/repo/feature', 'feature-new', { startPoint: 'origin/main' })

    expect(calls).toEqual([['switch', '-c', 'feature-new', 'origin/main']])
  })

  it('omits the start point when creating from HEAD', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        return { exitCode: 0 }
      })
    )

    await service.switchBranch('/repo/feature', 'feature-new', { startPoint: null })

    expect(calls).toEqual([['switch', '-c', 'feature-new']])
  })
})

describe('GitService.planBranchSwitch, creating a new branch (#69 review)', () => {
  it('never asks worktree list for a branch that does not exist yet — only an existing branch can be in use elsewhere', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'show-ref') return { exitCode: 1 }
        if (args[0] === 'status') return { exitCode: 0, stdout: '' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-new', {
      startPoint: null
    })

    expect(plan).toEqual({ outcome: 'clear', carriesChanges: false })
    expect(calls.some((call) => call[0] === 'worktree')).toBe(false)
  })

  it('diffs against the start point, not the (nonexistent) branch name, to find conflicts', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'show-ref') return { exitCode: 1 }
        if (args[0] === 'status') {
          return {
            exitCode: 0,
            stdout: statusV2Output('1 .M N... 100644 100644 100644 aaa aaa a.txt')
          }
        }
        if (args[0] === 'diff') return { exitCode: 0, stdout: 'a.txt ' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-new', {
      startPoint: 'origin/main'
    })

    expect(plan).toEqual({ outcome: 'conflicting', paths: ['a.txt'] })
    expect(calls.find((call) => call[0] === 'diff')).toEqual([
      'diff',
      '--name-only',
      '-z',
      'HEAD',
      'origin/main',
      '--'
    ])
  })

  it('diffs against HEAD itself when no start point is given, so a dirty tree never conflicts', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'show-ref') return { exitCode: 1 }
        if (args[0] === 'status') {
          return {
            exitCode: 0,
            stdout: statusV2Output('1 .M N... 100644 100644 100644 aaa aaa a.txt')
          }
        }
        if (args[0] === 'diff') return { exitCode: 0, stdout: '' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-new', {
      startPoint: null
    })

    expect(plan).toEqual({ outcome: 'clear', carriesChanges: true })
    expect(calls.find((call) => call[0] === 'diff')).toEqual([
      'diff',
      '--name-only',
      '-z',
      'HEAD',
      'HEAD',
      '--'
    ])
  })

  it('switches normally instead of erroring when the branch already exists by the time this runs', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'show-ref') return { exitCode: 0 }
        if (args[0] === 'worktree') return { exitCode: 0, stdout: 'worktree /repo\nHEAD aaa\n' }
        if (args[0] === 'status') return { exitCode: 0, stdout: '' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    const plan = await service.planBranchSwitch('/repo', '/repo', 'feature-x', {
      startPoint: null
    })

    expect(plan).toEqual({ outcome: 'clear', carriesChanges: false })
  })
})

describe('GitService.stashPush', () => {
  it('does nothing and returns false on a clean tree, without running stash push', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        return { exitCode: 0, stdout: '' }
      })
    )

    const stashed = await service.stashPush('/repo', 'a message', true)

    expect(stashed).toBe(false)
    expect(calls.some((call) => call[0] === 'stash')).toBe(false)
  })

  it('pushes with --include-untracked and -m on a dirty tree, and returns true', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'status') return { exitCode: 0, stdout: ' M a.txt\n' }
        return { exitCode: 0 }
      })
    )

    const stashed = await service.stashPush('/repo', 'switching branches', true)

    expect(stashed).toBe(true)
    expect(calls.find((call) => call[0] === 'stash')).toEqual([
      'stash',
      'push',
      '--include-untracked',
      '-m',
      'switching branches'
    ])
  })

  it('omits -m when the message is blank', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'status') return { exitCode: 0, stdout: ' M a.txt\n' }
        return { exitCode: 0 }
      })
    )

    await service.stashPush('/repo', '   ', false)

    expect(calls.find((call) => call[0] === 'stash')).toEqual(['stash', 'push'])
  })

  it('scopes both the dirty pre-check and the push itself to the given paths (#69 review)', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'status') return { exitCode: 0, stdout: 'A  a.txt\n' }
        return { exitCode: 0 }
      })
    )

    const stashed = await service.stashPush('/repo', 'scoped', true, ['a.txt', 'old.txt'])

    expect(stashed).toBe(true)
    expect(calls.find((call) => call[0] === 'status')).toEqual([
      'status',
      '--porcelain',
      '--',
      'a.txt',
      'old.txt'
    ])
    expect(calls.find((call) => call[0] === 'stash')).toEqual([
      'stash',
      'push',
      '--include-untracked',
      '-m',
      'scoped',
      '--',
      'a.txt',
      'old.txt'
    ])
  })

  it('does not run stash push when the given paths are clean, even if the tree overall is dirty', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        // The pre-check is restricted to the given paths, so it reports
        // clean even though a real dirty tree exists elsewhere.
        return { exitCode: 0, stdout: '' }
      })
    )

    const stashed = await service.stashPush('/repo', 'scoped', false, ['clean.txt'])

    expect(stashed).toBe(false)
    expect(calls.some((call) => call[0] === 'stash')).toBe(false)
  })

  it('omits the pathspec on both calls when paths is null', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'status') return { exitCode: 0, stdout: ' M a.txt\n' }
        return { exitCode: 0 }
      })
    )

    await service.stashPush('/repo', 'everything', false, null)

    expect(calls.find((call) => call[0] === 'status')).toEqual(['status', '--porcelain'])
    expect(calls.find((call) => call[0] === 'stash')).toEqual(['stash', 'push', '-m', 'everything'])
  })
})

describe('GitService.listStashes', () => {
  it('parses git stash list --format=%gd%x00%s%x00%aI', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        return { exitCode: 0, stdout: `stash@{0}${FS}A stash${FS}2026-08-20T14:00:00+00:00\n` }
      })
    )

    const stashes = await service.listStashes('/repo')

    expect(calls[0]).toEqual(['stash', 'list', '--format=%gd%x00%s%x00%aI'])
    expect(stashes).toEqual([
      { ref: 'stash@{0}', message: 'A stash', date: '2026-08-20T14:00:00+00:00' }
    ])
  })
})

describe('GitService.stashPop / stashApply', () => {
  it('resolves with no conflict on a clean pop', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'stash') return { exitCode: 0 }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    await expect(service.stashPop('/repo', 'stash@{0}')).resolves.toEqual({ conflict: false })
  })

  it('reports a conflict when a failed pop leaves unmerged entries, rather than reading stderr', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'stash')
          return { exitCode: 1, stderr: 'CONFLICT (content): Merge conflict' }
        if (args[0] === 'status') {
          return {
            exitCode: 0,
            stdout: statusV2Output('u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt')
          }
        }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    await expect(service.stashPop('/repo', 'stash@{0}')).resolves.toEqual({ conflict: true })
  })

  it('throws when the pop fails for a reason other than a conflict', async () => {
    const service = new GitService(
      fakeGit((args) => {
        if (args[0] === 'stash') return { exitCode: 1, stderr: 'No stash entries found.' }
        if (args[0] === 'status') return { exitCode: 0, stdout: '' }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    await expect(service.stashPop('/repo', 'stash@{9}')).rejects.toThrow('No stash entries found.')
  })

  it('applies without dropping, same conflict classification as pop', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        if (args[0] === 'stash') return { exitCode: 0 }
        throw new Error(`unexpected args: ${args.join(' ')}`)
      })
    )

    await expect(service.stashApply('/repo', 'stash@{0}')).resolves.toEqual({ conflict: false })
    expect(calls[0]).toEqual(['stash', 'apply', 'stash@{0}'])
  })
})

describe('GitService.stashDrop', () => {
  it('runs git stash drop <ref>', async () => {
    const calls: string[][] = []
    const service = new GitService(
      fakeGit((args) => {
        calls.push([...args])
        return { exitCode: 0 }
      })
    )

    await service.stashDrop('/repo', 'stash@{0}')

    expect(calls).toEqual([['stash', 'drop', 'stash@{0}']])
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
