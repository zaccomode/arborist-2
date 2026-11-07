import { describe, it, expect } from 'vitest'
import {
  commitGraphScopeLabel,
  commitGraphTips,
  formatRelativeDate,
  syncSummary,
  worktreeTitle
} from '@shared/format'
import type { Worktree } from '@shared/domain'

/**
 * Local time, deliberately, rather than a `...Z` instant.
 *
 * `formatRelativeDate` decides Today and Yesterday from the *local* calendar
 * day, which is the right behaviour for a UI — but it means a fixture
 * written in UTC lands on a different day depending on where the machine
 * is. `2026-08-20T02:00:00Z` is Today in London and Yesterday in Los
 * Angeles, so these assertions used to pass only on a machine running in
 * UTC, which in practice meant CI and nowhere else. Building the fixtures
 * with the local `Date` constructor pins the *relationship* between them,
 * which is what the behaviour is actually about.
 */
const now = new Date(2026, 7, 20, 14, 0)

function at(when: Date | string): string {
  return formatRelativeDate(typeof when === 'string' ? when : when.toISOString(), now)
}

/**
 * The same local wall-clock time, `days` calendar days before `now`. The
 * default hour is mid-morning so an hour of DST either way cannot move a
 * fixture across the midnight the day count is measured from.
 */
function daysBefore(days: number, hour = 9): Date {
  return new Date(2026, 7, 20 - days, hour)
}

describe('formatRelativeDate', () => {
  it('reads recent times in minutes', () => {
    expect(at(new Date(2026, 7, 20, 13, 59, 40))).toBe('Just now')
    expect(at(new Date(2026, 7, 20, 13, 59))).toBe('1 minute ago')
    expect(at(new Date(2026, 7, 20, 13, 30))).toBe('30 minutes ago')
  })

  it('says Today and Yesterday by calendar day, not by elapsed hours', () => {
    // Twelve hours back but the same calendar day, then three hours further
    // back and therefore the day before: the distinction is the point.
    expect(at(daysBefore(0, 2))).toBe('Today')
    expect(at(daysBefore(1, 23))).toBe('Yesterday')
  })

  it('counts days, then weeks', () => {
    expect(at(daysBefore(3))).toBe('3 days ago')
    expect(at(daysBefore(10))).toBe('1 week ago')
    expect(at(daysBefore(19))).toBe('2 weeks ago')
  })

  it('falls back to a date once the count stops meaning anything', () => {
    expect(at(new Date(2026, 0, 5, 9))).toMatch(/2026/)
  })

  it('returns nothing for an unparseable date', () => {
    expect(at('not a date')).toBe('')
  })
})

const worktree: Worktree = {
  path: '/code/feature-x',
  head: '46862b9c0f0e1a2b3c4d5e6f708192a3b4c5d6e7',
  branch: 'feature/x',
  isMain: false,
  isBare: false,
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  status: null,
  statusError: null
}

describe('worktreeTitle', () => {
  it('uses the branch name', () => {
    expect(worktreeTitle(worktree)).toBe('feature/x')
  })

  it('names a detached checkout by its commit', () => {
    expect(worktreeTitle({ ...worktree, branch: null })).toBe('detached at 46862b9')
  })

  it('falls back to the path when there is nothing else', () => {
    expect(worktreeTitle({ ...worktree, branch: null, head: null })).toBe('/code/feature-x')
  })
})

describe('syncSummary', () => {
  const status = {
    dirty: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    upstream: 'origin/feature/x',
    ahead: 0,
    behind: 0,
    gone: false,
    lastCommit: null
  }

  it('reads an up-to-date branch', () => {
    expect(syncSummary({ ...worktree, status })).toBe('Up-to-date with origin/feature/x')
  })

  it('reads divergence in both directions', () => {
    expect(syncSummary({ ...worktree, status: { ...status, ahead: 2, behind: 1 } })).toBe(
      '↑2 ↓1 from origin/feature/x'
    )
    expect(syncSummary({ ...worktree, status: { ...status, ahead: 2 } })).toBe(
      '↑2 ahead of origin/feature/x'
    )
    expect(syncSummary({ ...worktree, status: { ...status, behind: 3 } })).toBe(
      '↓3 behind origin/feature/x'
    )
  })

  it('separates a branch with no upstream from one whose upstream was deleted', () => {
    expect(syncSummary({ ...worktree, status: { ...status, upstream: null } })).toBe(
      'No upstream branch'
    )
    expect(syncSummary({ ...worktree, status: { ...status, gone: true } })).toBe(
      'origin/feature/x was deleted'
    )
  })

  it('says the folder is missing before anything about upstreams', () => {
    expect(syncSummary({ ...worktree, prunable: true, status })).toBe('Folder missing')
  })

  it('separates status still loading from status that failed', () => {
    expect(syncSummary(worktree)).toBe('Checking…')
    expect(syncSummary({ ...worktree, statusError: 'no such file' })).toBe('Status unavailable')
  })
})

describe('commitGraphTips', () => {
  const status = {
    dirty: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    upstream: 'origin/feature/x',
    ahead: 0,
    behind: 0,
    gone: false,
    lastCommit: null
  }

  it('is just the branch when there is no status yet', () => {
    expect(commitGraphTips(worktree)).toEqual(['feature/x'])
  })

  it('adds the upstream when one is tracked and not gone', () => {
    expect(commitGraphTips({ ...worktree, status })).toEqual(['feature/x', 'origin/feature/x'])
  })

  it('drops the upstream once it is gone', () => {
    expect(commitGraphTips({ ...worktree, status: { ...status, gone: true } })).toEqual([
      'feature/x'
    ])
  })

  it('drops the upstream when the branch was never pushed', () => {
    expect(commitGraphTips({ ...worktree, status: { ...status, upstream: null } })).toEqual([
      'feature/x'
    ])
  })

  it('falls back to HEAD when detached', () => {
    expect(commitGraphTips({ ...worktree, branch: null })).toEqual([worktree.head])
  })

  it('is empty for a worktree with neither a branch nor a HEAD', () => {
    expect(commitGraphTips({ ...worktree, branch: null, head: null })).toEqual([])
  })

  it('never lists the same ref twice', () => {
    expect(commitGraphTips({ ...worktree, status: { ...status, upstream: 'feature/x' } })).toEqual([
      'feature/x'
    ])
  })
})

describe('commitGraphScopeLabel', () => {
  const status = {
    dirty: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    upstream: 'origin/feature/x',
    ahead: 0,
    behind: 0,
    gone: false,
    lastCommit: null
  }

  it('names just the branch when there is no upstream', () => {
    expect(commitGraphScopeLabel(worktree)).toBe('feature/x')
  })

  it('names both tips when there is an upstream', () => {
    expect(commitGraphScopeLabel({ ...worktree, status })).toBe('feature/x and origin/feature/x')
  })

  it('labels a detached checkout the same short way worktreeTitle does', () => {
    expect(commitGraphScopeLabel({ ...worktree, branch: null })).toBe('detached at 46862b9')
  })

  it('is empty for a worktree with nothing to log', () => {
    expect(commitGraphScopeLabel({ ...worktree, branch: null, head: null })).toBe('')
  })
})
