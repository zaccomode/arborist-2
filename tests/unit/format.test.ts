import { describe, it, expect } from 'vitest'
import { formatRelativeDate, syncSummary, worktreeTitle } from '@shared/format'
import type { Worktree } from '@shared/domain'

const now = new Date('2026-08-20T14:00:00Z')

function at(iso: string): string {
  return formatRelativeDate(iso, now)
}

describe('formatRelativeDate', () => {
  it('reads recent times in minutes', () => {
    expect(at('2026-08-20T13:59:40Z')).toBe('Just now')
    expect(at('2026-08-20T13:59:00Z')).toBe('1 minute ago')
    expect(at('2026-08-20T13:30:00Z')).toBe('30 minutes ago')
  })

  it('says Today and Yesterday by calendar day, not by elapsed hours', () => {
    expect(at('2026-08-20T02:00:00Z')).toBe('Today')
    expect(at('2026-08-19T23:00:00Z')).toBe('Yesterday')
  })

  it('counts days, then weeks', () => {
    expect(at('2026-08-17T09:00:00Z')).toBe('3 days ago')
    expect(at('2026-08-10T09:00:00Z')).toBe('1 week ago')
    expect(at('2026-08-01T09:00:00Z')).toBe('2 weeks ago')
  })

  it('falls back to a date once the count stops meaning anything', () => {
    expect(at('2026-01-05T09:00:00Z')).toMatch(/2026/)
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
