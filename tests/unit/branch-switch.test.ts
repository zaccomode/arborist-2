import { describe, it, expect } from 'vitest'
import {
  conflictingPaths,
  decideBranchSwitch,
  parseNameOnlyZ,
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
