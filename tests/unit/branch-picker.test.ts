import { describe, it, expect } from 'vitest'
import {
  baseRows,
  filterRows,
  matchScore,
  offerCreate,
  resolveDefaultBranch,
  switchRows,
  type BranchRow
} from '@shared/branch-picker'
import type { CommitSummary, LocalBranch, RemoteBranch, WorktreeEntry } from '@shared/domain'

function commit(date: string, subject = 'A commit'): CommitSummary {
  return { hash: 'abcdef1234', shortHash: 'abcdef1', author: 'A', date, subject }
}

function local(
  name: string,
  date = '2026-01-01T00:00:00Z',
  upstream: string | null = null
): LocalBranch {
  return { name, upstream, lastCommit: commit(date) }
}

function remote(name: string, date = '2026-01-01T00:00:00Z'): RemoteBranch {
  return { name, shortName: name.slice(name.indexOf('/') + 1), lastCommit: commit(date) }
}

function worktree(path: string, branch: string | null): WorktreeEntry {
  return {
    path,
    head: 'abc',
    branch,
    isMain: path === '/repo',
    isBare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null
  }
}

const names = (rows: BranchRow[]): string[] => rows.map((row) => row.name)

describe('resolveDefaultBranch', () => {
  it("prefers whatever origin/HEAD points at, even when it isn't main or master", () => {
    expect(resolveDefaultBranch('origin/develop', ['main', 'develop'], [])).toBe('develop')
  })

  it('keeps a slash in the branch name past the remote prefix', () => {
    expect(resolveDefaultBranch('origin/release/stable', [], [])).toBe('release/stable')
  })

  it('falls back to main, then master, locally or on a remote', () => {
    expect(resolveDefaultBranch(null, ['feature', 'main'], [])).toBe('main')
    expect(resolveDefaultBranch(null, ['master', 'feature'], [])).toBe('master')
    expect(resolveDefaultBranch(null, ['feature'], ['master'])).toBe('master')
    expect(resolveDefaultBranch(null, ['main', 'master'], [])).toBe('main')
  })

  it('ignores a bare remote name with nothing after it', () => {
    expect(resolveDefaultBranch('origin', ['main'], [])).toBe('main')
  })

  it('is null when there is no default to find', () => {
    expect(resolveDefaultBranch(null, ['feature'], ['other'])).toBeNull()
  })
})

describe('switchRows', () => {
  const worktrees = [worktree('/repo', 'feature-here'), worktree('/repo-other', 'feature-there')]

  it('lists every branch with nothing typed, default first, then most recent', () => {
    const rows = switchRows({
      local: [
        local('old', '2025-01-01T00:00:00Z'),
        local('main', '2024-01-01T00:00:00Z'),
        local('new', '2026-06-01T00:00:00Z')
      ],
      remote: [remote('origin/middle', '2025-06-01T00:00:00Z')],
      worktrees: [],
      worktreePath: '/repo',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(names(rows)).toEqual(['main', 'new', 'origin/middle', 'old'])
    expect(rows[0].isDefault).toBe(true)
  })

  it("leaves out the worktree's own branch, and a remote shadowed by a local one", () => {
    const rows = switchRows({
      local: [local('feature-here'), local('main')],
      remote: [remote('origin/main'), remote('origin/only-remote')],
      worktrees,
      worktreePath: '/repo',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(names(rows)).toEqual(['main', 'origin/only-remote'])
  })

  it('lists a branch checked out elsewhere last, marked as unavailable', () => {
    const rows = switchRows({
      local: [local('feature-there', '2026-09-01T00:00:00Z'), local('older')],
      remote: [],
      worktrees,
      worktreePath: '/repo',
      defaultBranch: null,
      platform: 'linux'
    })
    expect(names(rows)).toEqual(['older', 'feature-there'])
    expect(rows[1].checkedOutAt).toBe('/repo-other')
  })

  it('does not pin a default branch that is checked out elsewhere (#96)', () => {
    const rows = switchRows({
      local: [local('main', '2020-01-01T00:00:00Z'), local('feature')],
      remote: [],
      worktrees: [worktree('/repo', 'main'), worktree('/repo-linked', 'other')],
      worktreePath: '/repo-linked',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(names(rows)).toEqual(['feature', 'main'])
  })

  it('pins a remote-only default branch when there is no local one', () => {
    const rows = switchRows({
      local: [local('feature', '2026-09-01T00:00:00Z')],
      remote: [remote('origin/main', '2020-01-01T00:00:00Z')],
      worktrees: [],
      worktreePath: '/repo',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(names(rows)).toEqual(['origin/main', 'feature'])
  })

  it('carries upstream and tip commit through for the row details', () => {
    const [row] = switchRows({
      local: [local('feature', '2026-01-01T00:00:00Z', 'origin/feature')],
      remote: [],
      worktrees: [],
      worktreePath: '/repo',
      defaultBranch: null,
      platform: 'linux'
    })
    expect(row.upstream).toBe('origin/feature')
    expect(row.lastCommit?.shortHash).toBe('abcdef1')
  })
})

describe('baseRows', () => {
  it('puts HEAD first, then the default branch, and includes every branch', () => {
    const rows = baseRows({
      local: [local('feature', '2026-09-01T00:00:00Z'), local('main', '2020-01-01T00:00:00Z')],
      remote: [remote('origin/other')],
      defaultBranch: 'main',
      head: { branch: 'feature', lastCommit: null }
    })
    expect(rows.map((row) => row.key)).toEqual([
      'head',
      'local:main',
      'local:feature',
      'remote:origin/other'
    ])
    expect(rows[0].name).toBe('')
  })
})

describe('matchScore', () => {
  const row = (name: string, kind: BranchRow['kind'] = 'local'): BranchRow => ({
    key: name,
    kind,
    name,
    shortName: kind === 'remote' ? name.slice(name.indexOf('/') + 1) : name,
    isDefault: false,
    upstream: null,
    lastCommit: null,
    checkedOutAt: null
  })

  it('ranks exact, prefix, segment, substring and loose matches in that order', () => {
    expect(matchScore('main', row('main'))).toBe(0)
    expect(matchScore('main', row('origin/main', 'remote'))).toBe(0)
    expect(matchScore('mai', row('main'))).toBe(1)
    expect(matchScore('login', row('feature/login-form'))).toBe(2)
    expect(matchScore('form', row('feature/login-form'))).toBe(2)
    expect(matchScore('ogin', row('feature/login-form'))).toBe(3)
    expect(matchScore('flf', row('feature/login-form'))).toBe(4)
    expect(matchScore('zzz', row('feature/login-form'))).toBeNull()
  })

  it('is case-insensitive against the name', () => {
    expect(matchScore('readme', row('fix/README'))).toBe(2)
  })
})

describe('filterRows', () => {
  const rows = switchRows({
    local: [
      local('feature/domain-maintenance', '2026-09-01T00:00:00Z'),
      local('maintenance', '2026-08-01T00:00:00Z'),
      local('main', '2020-01-01T00:00:00Z'),
      local('feature/login', '2026-07-01T00:00:00Z')
    ],
    remote: [],
    worktrees: [],
    worktreePath: '/repo',
    defaultBranch: 'main',
    platform: 'linux'
  })

  it('returns everything, in resting order, for an empty or blank search', () => {
    expect(filterRows(rows, '')).toEqual(rows)
    expect(filterRows(rows, '   ')).toEqual(rows)
  })

  it('surfaces main first when searching for it (#96)', () => {
    expect(names(filterRows(rows, 'main'))).toEqual([
      'main',
      'maintenance',
      'feature/domain-maintenance'
    ])
  })

  it('keeps the default branch on top among equally good matches', () => {
    expect(names(filterRows(rows, 'ma'))[0]).toBe('main')
  })

  it('lets a better match beat the default branch', () => {
    expect(names(filterRows(rows, 'login'))).toEqual(['feature/login'])
  })

  it('keeps unavailable rows below available ones whatever their score', () => {
    const withBusy = switchRows({
      local: [local('main'), local('mainline')],
      remote: [],
      worktrees: [worktree('/repo', 'other'), worktree('/x', 'main')],
      worktreePath: '/repo',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(names(filterRows(withBusy, 'main'))).toEqual(['mainline', 'main'])
  })
})

describe('offerCreate', () => {
  it('offers a name that is no branch at all', () => {
    expect(offerCreate('feature/new', ['main'], [])).toBe(true)
  })

  it('does not offer an empty search, or one that names an existing branch', () => {
    expect(offerCreate('  ', ['main'], [])).toBe(false)
    expect(offerCreate('main', ['main'], [])).toBe(false)
    expect(offerCreate(' main ', ['main'], [])).toBe(false)
  })

  it("does not offer a remote branch's name, by either the full ref or the short name", () => {
    expect(offerCreate('origin/feature', [], [remote('origin/feature')])).toBe(false)
    expect(offerCreate('feature', [], [remote('origin/feature')])).toBe(false)
  })
})
