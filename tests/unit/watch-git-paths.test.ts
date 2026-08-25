import { join, sep } from 'path'
import { describe, it, expect, vi } from 'vitest'
import { reasonForGitPath, resolveGitWatchPaths } from '../../src/main/services/watch/git-paths'
import type { GitRunner } from '../../src/main/services/git/git-runner'
import type { GitExecResult } from '../../src/main/services/git/git-executor'

/** A `GitRunner` whose response depends on the args it was called with. */
function fakeGit(responder: (args: readonly string[]) => Partial<GitExecResult>): GitRunner {
  const run = vi.fn(async (args: readonly string[]) => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
    ...responder(args)
  }))
  return { run } as unknown as GitRunner
}

const worktreePath = join(sep, 'proj', 'worktrees', 'feat')
const commonDir = join(sep, 'proj', '.git')

describe('resolveGitWatchPaths', () => {
  it('resolves the linked-worktree shape: an index outside the worktree, refs under the common dir', async () => {
    const git = fakeGit((args) => {
      if (args.join(' ') === 'rev-parse --git-path index') {
        return { stdout: join(sep, 'proj', '.git', 'worktrees', 'feat', 'index') + '\n' }
      }
      if (args.join(' ') === 'rev-parse --git-path HEAD') {
        return { stdout: join(sep, 'proj', '.git', 'worktrees', 'feat', 'HEAD') + '\n' }
      }
      if (args.join(' ') === 'rev-parse --git-common-dir') {
        return { stdout: commonDir + '\n' }
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`)
    })

    const paths = await resolveGitWatchPaths(git, worktreePath)

    expect(paths).toEqual({
      index: join(sep, 'proj', '.git', 'worktrees', 'feat', 'index'),
      head: join(sep, 'proj', '.git', 'worktrees', 'feat', 'HEAD'),
      refsHeads: join(commonDir, 'refs', 'heads'),
      packedRefs: join(commonDir, 'packed-refs')
    })
  })

  it('falls back to joining a relative result onto the worktree path', async () => {
    const git = fakeGit((args) => {
      if (args.includes('index')) return { stdout: '.git/index\n' }
      if (args.includes('HEAD')) return { stdout: '.git/HEAD\n' }
      return { stdout: '.git\n' }
    })

    const paths = await resolveGitWatchPaths(git, worktreePath)

    expect(paths?.index).toBe(join(worktreePath, '.git/index'))
    expect(paths?.refsHeads).toBe(join(worktreePath, '.git', 'refs', 'heads'))
  })

  it('resolves to null when any of the three calls fails', async () => {
    const git = fakeGit((args) => ({
      stdout: '',
      exitCode: args.includes('HEAD') ? 128 : 0
    }))

    expect(await resolveGitWatchPaths(git, worktreePath)).toBeNull()
  })
})

describe('reasonForGitPath', () => {
  const paths = {
    index: join(commonDir, 'worktrees', 'feat', 'index'),
    head: join(commonDir, 'worktrees', 'feat', 'HEAD'),
    refsHeads: join(commonDir, 'refs', 'heads'),
    packedRefs: join(commonDir, 'packed-refs')
  }

  it('maps the index file to "index"', () => {
    expect(reasonForGitPath(paths.index, paths)).toBe('index')
  })

  it('maps the HEAD file to "head"', () => {
    expect(reasonForGitPath(paths.head, paths)).toBe('head')
  })

  it('maps packed-refs to "refs"', () => {
    expect(reasonForGitPath(paths.packedRefs, paths)).toBe('refs')
  })

  it('maps a file nested under refs/heads to "refs", branch names nest', () => {
    expect(reasonForGitPath(join(paths.refsHeads, 'feature', 'x'), paths)).toBe('refs')
  })

  it('maps a path outside all four to null', () => {
    expect(reasonForGitPath(join(commonDir, 'FETCH_HEAD'), paths)).toBeNull()
  })
})
