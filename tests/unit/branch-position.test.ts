import { describe, it, expect } from 'vitest'
import {
  branchPositionLabel,
  chooseBaseRef,
  isDefaultBranchRef
} from '../../src/shared/branch-position'

describe('chooseBaseRef (#151)', () => {
  it("prefers origin's copy of the default branch over the local one", () => {
    expect(chooseBaseRef('main', ['main'], ['origin/main', 'upstream/main'])).toBe('origin/main')
  })

  it('takes another remote when origin has no copy', () => {
    expect(chooseBaseRef('main', ['main'], ['upstream/main'])).toBe('upstream/main')
  })

  it('falls back to the local branch with no remote copy at all', () => {
    expect(chooseBaseRef('main', ['main'], ['origin/feature'])).toBe('main')
  })

  it('does not mistake a branch that merely ends in the name for it', () => {
    expect(chooseBaseRef('main', [], ['origin/not-main'])).toBeNull()
  })

  it('does not mistake a branch whose last segment is the name for it (#161)', () => {
    expect(chooseBaseRef('main', ['main'], ['origin/feature/main'])).toBe('main')
    expect(chooseBaseRef('main', ['main'], ['fork/alice/main', 'fork/main'])).toBe('fork/main')
  })

  it('has no base without a default branch, or when it exists nowhere', () => {
    expect(chooseBaseRef(null, ['main'], ['origin/main'])).toBeNull()
    expect(chooseBaseRef('trunk', ['main'], ['origin/main'])).toBeNull()
  })
})

describe('isDefaultBranchRef', () => {
  it('matches the default branch by name and by its base ref', () => {
    expect(isDefaultBranchRef('main', 'main', 'origin/main')).toBe(true)
    expect(isDefaultBranchRef('origin/main', 'main', 'origin/main')).toBe(true)
  })

  it('leaves every other branch alone', () => {
    expect(isDefaultBranchRef('feature/main', 'main', 'origin/main')).toBe(false)
    expect(isDefaultBranchRef('main', null, null)).toBe(false)
  })
})

describe('branchPositionLabel', () => {
  const base = 'origin/main'

  it('says both counts when the branch has diverged', () => {
    expect(branchPositionLabel({ base, ahead: 3, behind: 2 })).toBe('3 ahead, 2 behind origin/main')
  })

  it('says only the count that applies', () => {
    expect(branchPositionLabel({ base, ahead: 3, behind: 0 })).toBe('3 ahead of origin/main')
    expect(branchPositionLabel({ base, ahead: 0, behind: 2 })).toBe('2 behind origin/main')
  })

  it('says when the branch is level with the default branch', () => {
    expect(branchPositionLabel({ base, ahead: 0, behind: 0 })).toBe('Even with origin/main')
  })

  it('shows nothing without a position', () => {
    expect(branchPositionLabel(null)).toBeNull()
  })

  it('shows nothing when the base is also the upstream, whose chip already says it', () => {
    expect(branchPositionLabel({ base, ahead: 1, behind: 0 }, 'origin/main')).toBeNull()
    expect(branchPositionLabel({ base, ahead: 1, behind: 0 }, 'origin/feature')).toBe(
      '1 ahead of origin/main'
    )
  })
})
