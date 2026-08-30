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
  it('names the count when there is one', () => {
    expect(pullLabel(3)).toBe('Pull 3')
  })

  it('stays a bare Pull at zero rather than inviting you not to press it', () => {
    expect(pullLabel(0)).toBe('Pull')
  })
})

describe('syncAvailability', () => {
  it('offers both actions on an ordinary tracked branch', () => {
    const result = syncAvailability(worktree({}, { ahead: 2, behind: 1 }))

    expect(result).toMatchObject({ visible: true, canPull: true, pushEnabled: true })
  })

  it('hides the pair entirely on a detached HEAD, which has no branch to name', () => {
    expect(syncAvailability(worktree({ branch: null })).visible).toBe(false)
  })

  it('hides the pair on a worktree whose folder has gone', () => {
    expect(syncAvailability(worktree({ prunable: true })).visible).toBe(false)
  })

  it('hides the pair while enrichment has not produced a status', () => {
    expect(syncAvailability(worktree({ status: null })).visible).toBe(false)
  })

  it('drops pull for a branch that was never pushed, which has nothing to pull from', () => {
    const result = syncAvailability(worktree({}, { upstream: null }))

    expect(result.canPull).toBe(false)
    // 0 ahead with no upstream is not the same fact as nothing to publish.
    expect(result.pushEnabled).toBe(true)
  })

  it('drops pull once the upstream is deleted on the remote', () => {
    expect(syncAvailability(worktree({}, { gone: true })).canPull).toBe(false)
  })

  it('disables push when the branch is level with its upstream', () => {
    expect(syncAvailability(worktree({}, { ahead: 0 })).pushEnabled).toBe(false)
  })
})
