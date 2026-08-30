import { describe, it, expect } from 'vitest'
import type { Worktree } from '../../src/shared/domain'
import { pullArgsFor, pullLabel, syncAvailability } from '../../src/shared/sync'

function worktree(
  overrides: Partial<Worktree> = {},
  status: Record<string, unknown> = {}
): Worktree {
  return {
    path: '/repo/feature',
    head: 'a'.repeat(40),
    branch: 'feature/x',
    isMain: false,
    isBare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    statusError: null,
    status: {
      dirty: false,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      upstream: 'origin/feature/x',
      ahead: 0,
      behind: 0,
      gone: false,
      lastCommit: null,
      ...status
    },
    ...overrides
  } as Worktree
}

describe('pullArgsFor', () => {
  /**
   * `-c` is a global option, so it has to precede the subcommand — after it,
   * git reads it as an argument to `pull` and fails. `execGitAt` prepends its
   * own `-C <repo>`, which is global too, so the two sit side by side.
   */
  it('puts the no-op editor config before the subcommand, where git will read it', () => {
    for (const mode of ['ff-only', 'rebase', 'merge'] as const) {
      const args = pullArgsFor(mode)
      expect(args.slice(0, 3)).toEqual(['-c', 'core.editor=true', 'pull'])
    }
  })

  it('fast-forwards by default and never merges', () => {
    expect(pullArgsFor('ff-only')).toContain('--ff-only')
    expect(pullArgsFor('ff-only')).not.toContain('--rebase')
  })

  it('rebases or merges explicitly, never leaving the choice to pull.rebase config', () => {
    expect(pullArgsFor('rebase')).toContain('--rebase')
    expect(pullArgsFor('merge')).toContain('--no-rebase')
    expect(pullArgsFor('merge')).toContain('--no-edit')
  })
})

describe('pullLabel', () => {
  it('names the count, which is the only case it is rendered in', () => {
    expect(pullLabel(3)).toBe('Pull 3')
    expect(pullLabel(1)).toBe('Pull 1')
  })
})

describe('syncAvailability', () => {
  it('offers both actions on a branch that is ahead and behind at once', () => {
    const result = syncAvailability(worktree({}, { ahead: 2, behind: 1 }))

    expect(result).toMatchObject({ canPull: true, canPush: true })
  })

  /**
   * #79 review: each button exists only when it has work to do, rather than
   * standing there disabled. A branch level with its upstream therefore shows
   * neither, and the component renders nothing at all.
   */
  it('offers neither on a branch level with its upstream', () => {
    const result = syncAvailability(worktree({}, { ahead: 0, behind: 0 }))

    expect(result).toMatchObject({ canPull: false, canPush: false })
  })

  it('offers pull alone when the branch is only behind', () => {
    expect(syncAvailability(worktree({}, { behind: 3 }))).toMatchObject({
      canPull: true,
      canPush: false
    })
  })

  it('offers push alone when the branch is only ahead', () => {
    expect(syncAvailability(worktree({}, { ahead: 3 }))).toMatchObject({
      canPull: false,
      canPush: true
    })
  })

  it('offers neither on a detached HEAD, which has no branch to name', () => {
    const result = syncAvailability(worktree({ branch: null }, { ahead: 2, behind: 1 }))

    expect(result).toMatchObject({ canPull: false, canPush: false })
  })

  it('offers neither on a worktree whose folder has gone', () => {
    const result = syncAvailability(worktree({ prunable: true }, { ahead: 2, behind: 1 }))

    expect(result).toMatchObject({ canPull: false, canPush: false })
  })

  it('offers neither while enrichment has not produced a status', () => {
    const result = syncAvailability(worktree({ status: null }))

    expect(result).toMatchObject({ canPull: false, canPush: false })
  })

  it('offers push on a branch that was never pushed, where 0 ahead is not nothing to do', () => {
    const result = syncAvailability(worktree({}, { upstream: null, ahead: 0 }))

    expect(result.canPush).toBe(true)
    expect(result.canPull).toBe(false)
  })

  it('drops pull once the upstream is deleted on the remote, whatever the stale count says', () => {
    expect(syncAvailability(worktree({}, { gone: true, behind: 4 })).canPull).toBe(false)
  })
})
