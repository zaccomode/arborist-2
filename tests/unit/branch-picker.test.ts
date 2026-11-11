import { describe, it, expect } from 'vitest'
import {
  baseRows,
  createGoesFirst,
  filterRows,
  matchScore,
  offerCreate,
  resolveDefaultBranch,
  rowLabel,
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
      currentBranch: null,
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
      currentBranch: 'feature-here',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(names(rows)).toEqual(['main', 'origin/only-remote'])
  })

  /**
   * #137: the worktree list can lag the worktree itself — still loading, or
   * not yet refreshed after a switch — so the current branch is left out on
   * the worktree's own say-so as well.
   */
  it("leaves out the worktree's own branch even when the worktree list doesn't have it", () => {
    const rows = switchRows({
      local: [local('feature-here'), local('main')],
      remote: [],
      worktrees: [],
      worktreePath: '/repo',
      currentBranch: 'feature-here',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(names(rows)).toEqual(['main'])
  })

  it('lists a branch checked out elsewhere last, marked as unavailable', () => {
    const rows = switchRows({
      local: [local('feature-there', '2026-09-01T00:00:00Z'), local('older')],
      remote: [],
      worktrees,
      worktreePath: '/repo',
      currentBranch: 'feature-here',
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
      currentBranch: 'other',
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
      currentBranch: null,
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
      currentBranch: null,
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

  it('builds the same local and remote rows as the switch list does', () => {
    const args = {
      local: [local('feature')],
      remote: [remote('origin/other')],
      defaultBranch: null
    }
    const switchList = switchRows({
      ...args,
      worktrees: [],
      worktreePath: '/repo',
      currentBranch: null,
      platform: 'linux'
    })
    const baseList = baseRows({ ...args, head: { branch: null, lastCommit: null } })
    expect(baseList.slice(1)).toEqual(switchList)
  })
})

describe('rowLabel', () => {
  const head = (branch: string | null): BranchRow =>
    baseRows({ local: [], remote: [], defaultBranch: null, head: { branch, lastCommit: null } })[0]

  it('names the branch HEAD is on', () => {
    expect(rowLabel(head('feature/x'))).toBe('HEAD (feature/x)')
  })

  it("doesn't repeat itself on a detached HEAD (#137)", () => {
    expect(rowLabel(head(null))).toBe('HEAD')
  })

  it('is just the name for any other row', () => {
    expect(
      rowLabel(
        baseRows({
          local: [],
          remote: [remote('origin/x')],
          defaultBranch: null,
          head: { branch: null, lastCommit: null }
        })[1]
      )
    ).toBe('origin/x')
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
    currentBranch: null,
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
      currentBranch: 'other',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(names(filterRows(withBusy, 'main'))).toEqual(['mainline', 'main'])
  })
})

describe('createGoesFirst', () => {
  /** The repro from #137. */
  const rows = switchRows({
    local: [local('main'), local('feature/write-api')],
    remote: [remote('origin/develop')],
    worktrees: [worktree('/repo', 'main')],
    worktreePath: '/repo',
    currentBranch: 'main',
    defaultBranch: 'main',
    platform: 'linux'
  })

  it('puts create first for a new name that only loosely matches a branch (#137)', () => {
    // w…i…p appear in order in feature/write-api, so it is still listed —
    // but Enter must create `wip`, not check out feature/write-api.
    expect(names(filterRows(rows, 'wip'))).toEqual(['feature/write-api'])
    expect(matchScore('wip', filterRows(rows, 'wip')[0])).toBe(4)
    expect(offerCreate('wip', ['main', 'feature/write-api'], [remote('origin/develop')])).toBe(true)
    expect(createGoesFirst(filterRows(rows, 'wip'), 'wip')).toBe(true)
  })

  it('puts create first when the only match is a substring', () => {
    expect(matchScore('rite', filterRows(rows, 'rite')[0])).toBe(3)
    expect(createGoesFirst(filterRows(rows, 'rite'), 'rite')).toBe(true)
  })

  it('keeps a prefix or segment-prefix match above create', () => {
    expect(createGoesFirst(filterRows(rows, 'feat'), 'feat')).toBe(false)
    expect(createGoesFirst(filterRows(rows, 'write'), 'write')).toBe(false)
    expect(createGoesFirst(filterRows(rows, 'dev'), 'dev')).toBe(false)
  })

  it('ignores a confident match that cannot be picked anyway', () => {
    const busy = switchRows({
      local: [local('main'), local('wip-old')],
      remote: [],
      worktrees: [worktree('/repo', 'main'), worktree('/other', 'wip-old')],
      worktreePath: '/repo',
      currentBranch: 'main',
      defaultBranch: 'main',
      platform: 'linux'
    })
    expect(createGoesFirst(filterRows(busy, 'wip'), 'wip')).toBe(true)
  })

  it('has nothing to put first for an empty search', () => {
    expect(createGoesFirst(rows, '  ')).toBe(false)
  })

  it('puts create first when nothing matches at all', () => {
    expect(createGoesFirst(filterRows(rows, 'zzz'), 'zzz')).toBe(true)
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
