import { describe, it, expect } from 'vitest'
import {
  conflictingPaths,
  decideBranchSwitch,
  parseNameOnlyZ,
  resolveSwitchTarget,
  worktreeUsingBranch
} from '@shared/branch-switch'
import type { WorktreeEntry } from '@shared/domain'

function entry(overrides: Partial<WorktreeEntry>): WorktreeEntry {
  return {
    path: '/repo',
    head: 'abc123',
    branch: 'main',
    isMain: true,
    isBare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    ...overrides
  }
}

describe('parseNameOnlyZ', () => {
  it('splits NUL-terminated paths', () => {
    expect(parseNameOnlyZ('a.txt\u0000b/c.txt\u0000')).toEqual(['a.txt', 'b/c.txt'])
  })

  it('drops the trailing empty field', () => {
    expect(parseNameOnlyZ('a.txt\u0000')).toEqual(['a.txt'])
  })

  it('returns an empty array for empty output', () => {
    expect(parseNameOnlyZ('')).toEqual([])
  })
})

describe('worktreeUsingBranch', () => {
  it('finds the other worktree already on the branch', () => {
    const entries = [
      entry({ path: '/repo', branch: 'main' }),
      entry({ path: '/repo/../feature', branch: 'feature-x', isMain: false })
    ]
    const found = worktreeUsingBranch(entries, 'feature-x', '/repo', 'darwin')
    expect(found?.path).toBe('/repo/../feature')
  })

  it('is null when nothing else is on the branch', () => {
    const entries = [entry({ path: '/repo', branch: 'main' })]
    expect(worktreeUsingBranch(entries, 'feature-x', '/repo', 'darwin')).toBeNull()
  })

  it('excludes the worktree asking, even when it already has the branch checked out', () => {
    const entries = [entry({ path: '/repo/feature', branch: 'feature-x', isMain: false })]
    expect(worktreeUsingBranch(entries, 'feature-x', '/repo/feature', 'darwin')).toBeNull()
  })

  it('compares paths platform-aware, so a win32 case difference still matches', () => {
    const entries = [entry({ path: 'C:\\Code\\other', branch: 'feature-x', isMain: false })]
    const found = worktreeUsingBranch(entries, 'feature-x', 'c:\\code\\other', 'win32')
    expect(found).toBeNull()
  })
})

describe('conflictingPaths', () => {
  it('intersects the branch diff with what is dirty now', () => {
    expect(conflictingPaths(['a.txt', 'b.txt'], ['b.txt', 'c.txt'])).toEqual(['b.txt'])
  })

  it('is empty when nothing overlaps', () => {
    expect(conflictingPaths(['a.txt'], ['b.txt'])).toEqual([])
  })
})

describe('decideBranchSwitch', () => {
  const base = {
    branchExists: true,
    inUseAt: null,
    hasUnmerged: false,
    changedPaths: [] as string[],
    diffPaths: [] as string[]
  }

  it('refuses a branch that does not exist, before anything else is asked', () => {
    expect(decideBranchSwitch({ ...base, branchExists: false, inUseAt: '/elsewhere' })).toEqual({
      outcome: 'branch-missing'
    })
  })

  it('refuses a branch already checked out in another worktree', () => {
    expect(decideBranchSwitch({ ...base, inUseAt: '/elsewhere' })).toEqual({
      outcome: 'in-use',
      path: '/elsewhere'
    })
  })

  it('refuses when unmerged paths are present', () => {
    expect(decideBranchSwitch({ ...base, hasUnmerged: true })).toEqual({ outcome: 'unmerged' })
  })

  it('is clear with no carried changes on a clean tree', () => {
    expect(decideBranchSwitch(base)).toEqual({ outcome: 'clear', carriesChanges: false })
  })

  it('is clear but carries changes when dirty paths do not conflict with the branch', () => {
    const plan = decideBranchSwitch({
      ...base,
      changedPaths: ['a.txt'],
      diffPaths: ['b.txt']
    })
    expect(plan).toEqual({ outcome: 'clear', carriesChanges: true })
  })

  it('reports the conflicting paths when the branch and the dirty tree overlap', () => {
    const plan = decideBranchSwitch({
      ...base,
      changedPaths: ['a.txt', 'b.txt'],
      diffPaths: ['b.txt', 'c.txt']
    })
    expect(plan).toEqual({ outcome: 'conflicting', paths: ['b.txt'] })
  })

  describe('creating a new branch (#69 review)', () => {
    it('is clear rather than branch-missing when the branch does not exist yet', () => {
      const plan = decideBranchSwitch({ ...base, branchExists: false, creating: true })
      expect(plan).toEqual({ outcome: 'clear', carriesChanges: false })
    })

    it('still refuses when the tree has unmerged paths, same as an ordinary switch', () => {
      const plan = decideBranchSwitch({
        ...base,
        branchExists: false,
        creating: true,
        hasUnmerged: true
      })
      expect(plan).toEqual({ outcome: 'unmerged' })
    })

    it('still checks inUseAt if the caller passes one — decideBranchSwitch trusts its inputs; `GitService.planBranchSwitch` is what never populates inUseAt for a branch that does not exist yet', () => {
      const plan = decideBranchSwitch({
        ...base,
        branchExists: false,
        creating: true,
        inUseAt: '/elsewhere'
      })
      expect(plan).toEqual({ outcome: 'in-use', path: '/elsewhere' })
    })

    it('reports conflicts against a start point other than HEAD, exactly like switching to an existing divergent branch', () => {
      const plan = decideBranchSwitch({
        ...base,
        branchExists: false,
        creating: true,
        changedPaths: ['a.txt'],
        diffPaths: ['a.txt']
      })
      expect(plan).toEqual({ outcome: 'conflicting', paths: ['a.txt'] })
    })

    it('switches normally, ignoring `creating`, once the branch turns out to already exist', () => {
      const plan = decideBranchSwitch({ ...base, branchExists: true, creating: true })
      expect(plan).toEqual({ outcome: 'clear', carriesChanges: false })
    })
  })
})

describe('resolveSwitchTarget', () => {
  const remotes = [
    { name: 'origin/feature-x', shortName: 'feature-x' },
    { name: 'origin/main', shortName: 'main' }
  ]

  it('is empty for empty input, so nothing is offered before anything is picked', () => {
    expect(resolveSwitchTarget('  ', ['main'], remotes, null)).toEqual({
      branch: '',
      create: null,
      tracking: null
    })
  })

  it('switches to a local branch as it always did', () => {
    expect(resolveSwitchTarget('feature-y', ['main', 'feature-y'], remotes, null)).toEqual({
      branch: 'feature-y',
      create: null,
      tracking: null
    })
  })

  /**
   * You cannot check out a remote-tracking ref — `git switch origin/x` either
   * detaches HEAD or refuses — so a picked remote row resolves to the local
   * branch that follows it, created from the ref.
   */
  it('turns a picked remote ref into a local branch created from it', () => {
    expect(resolveSwitchTarget('origin/feature-x', ['main'], remotes, null)).toEqual({
      branch: 'feature-x',
      create: { startPoint: 'origin/feature-x' },
      tracking: 'origin/feature-x'
    })
  })

  it('switches to the local branch a picked remote ref already has, rather than making a second one', () => {
    expect(resolveSwitchTarget('origin/feature-x', ['main', 'feature-x'], remotes, null)).toEqual({
      branch: 'feature-x',
      create: null,
      tracking: null
    })
  })

  /** #86: the case the issue is about — the remote wins over "from HEAD". */
  it('bases a typed name with no local branch on the remote branch of that name', () => {
    expect(resolveSwitchTarget('feature-x', ['main'], remotes, null)).toEqual({
      branch: 'feature-x',
      create: { startPoint: 'origin/feature-x' },
      tracking: 'origin/feature-x'
    })
  })

  it('prefers the remote over the Base picker, which is the fallback rather than an override', () => {
    expect(resolveSwitchTarget('feature-x', ['main'], remotes, 'main')).toEqual({
      branch: 'feature-x',
      create: { startPoint: 'origin/feature-x' },
      tracking: 'origin/feature-x'
    })
  })

  it('falls back to the Base picker for a name no remote has', () => {
    expect(resolveSwitchTarget('brand-new', ['main'], remotes, 'main')).toEqual({
      branch: 'brand-new',
      create: { startPoint: 'main' },
      tracking: null
    })
  })

  it('falls back to HEAD when the Base picker is empty too', () => {
    expect(resolveSwitchTarget('brand-new', ['main'], remotes, null)).toEqual({
      branch: 'brand-new',
      create: { startPoint: null },
      tracking: null
    })
  })

  /**
   * A local branch stays that local branch. Resolving it to the remote would
   * mean resetting someone's branch to its upstream, which is a destructive
   * operation and not something a picker should do quietly.
   */
  it('leaves an existing local branch alone even when a remote of that name exists', () => {
    expect(resolveSwitchTarget('main', ['main'], remotes, null)).toEqual({
      branch: 'main',
      create: null,
      tracking: null
    })
  })

  it('trims what was typed, so a stray space is not a different branch', () => {
    expect(resolveSwitchTarget('  feature-x  ', ['main'], remotes, null).branch).toBe('feature-x')
  })

  it('creates from HEAD when there are no remotes at all', () => {
    expect(resolveSwitchTarget('feature-x', ['main'], [], null)).toEqual({
      branch: 'feature-x',
      create: { startPoint: null },
      tracking: null
    })
  })
})
