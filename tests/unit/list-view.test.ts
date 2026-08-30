import { describe, it, expect } from 'vitest'
import type { RemoteBranch, Worktree } from '../../src/shared/domain'
import {
  filterRemoteBranches,
  filterWorktrees,
  isPinnedWorktree,
  sortRemoteBranches,
  sortWorktrees
} from '../../src/shared/list-view'

function worktree(
  branch: string | null,
  options: { isMain?: boolean; date?: string | null; path?: string; head?: string | null } = {}
): Worktree {
  const {
    isMain = false,
    date = null,
    path = `/repo/${branch ?? 'detached'}`,
    head = 'a'.repeat(40)
  } = options
  return {
    path,
    head,
    branch,
    isMain,
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
      upstream: null,
      ahead: 0,
      behind: 0,
      gone: false,
      lastCommit: date
        ? { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'A', date, subject: 'S' }
        : null
    }
  }
}

function remote(name: string, date: string | null = null): RemoteBranch {
  return {
    name,
    shortName: name.slice(name.indexOf('/') + 1),
    lastCommit: date
      ? { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', author: 'B', date, subject: 'S' }
      : null
  }
}

const names = (worktrees: Worktree[]): (string | null)[] => worktrees.map((w) => w.branch)

describe('isPinnedWorktree', () => {
  it('pins the repository’s own worktree whatever its branch is called', () => {
    expect(isPinnedWorktree(worktree('trunk', { isMain: true }))).toBe(true)
  })

  it('pins a worktree on main or master even when it is not the repository’s own', () => {
    expect(isPinnedWorktree(worktree('main'))).toBeTruthy()
    expect(isPinnedWorktree(worktree('master'))).toBeTruthy()
  })

  it('leaves an ordinary branch unpinned, including one merely starting with main', () => {
    expect(isPinnedWorktree(worktree('feature/x'))).toBe(false)
    expect(isPinnedWorktree(worktree('maintenance'))).toBe(false)
  })
})

describe('sortWorktrees', () => {
  it('sorts alphabetically, ignoring the order git happened to list them in', () => {
    const list = [worktree('zeta'), worktree('alpha'), worktree('mid')]

    expect(names(sortWorktrees(list, 'alphabetical', false))).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('collates numerically, so release/2 comes before release/10', () => {
    const list = [worktree('release/10'), worktree('release/2')]

    expect(names(sortWorktrees(list, 'alphabetical', false))).toEqual(['release/2', 'release/10'])
  })

  it('sorts by tip commit date, newest first', () => {
    const list = [
      worktree('old', { date: '2026-01-01T00:00:00Z' }),
      worktree('new', { date: '2026-08-01T00:00:00Z' }),
      worktree('middle', { date: '2026-04-01T00:00:00Z' })
    ]

    expect(names(sortWorktrees(list, 'recently-updated', false))).toEqual(['new', 'middle', 'old'])
  })

  it('puts an undated worktree last rather than treating it as infinitely old', () => {
    const list = [worktree('undated'), worktree('dated', { date: '2020-01-01T00:00:00Z' })]

    expect(names(sortWorktrees(list, 'recently-updated', false))).toEqual(['dated', 'undated'])
  })

  it('breaks a date tie by name, so a shared commit date still has one stable order', () => {
    const date = '2026-01-01T00:00:00Z'
    const list = [worktree('zeta', { date }), worktree('alpha', { date })]

    expect(names(sortWorktrees(list, 'recently-updated', false))).toEqual(['alpha', 'zeta'])
  })

  it('pins main above the rest without disturbing the order of either group', () => {
    const list = [
      worktree('zeta'),
      worktree('main', { isMain: true }),
      worktree('alpha'),
      worktree('master')
    ]

    expect(names(sortWorktrees(list, 'alphabetical', true))).toEqual([
      'main',
      'master',
      'alpha',
      'zeta'
    ])
  })

  it('sorts main in with the rest once the pin is switched off', () => {
    const list = [worktree('zeta'), worktree('main', { isMain: true }), worktree('alpha')]

    expect(names(sortWorktrees(list, 'alphabetical', false))).toEqual(['alpha', 'main', 'zeta'])
  })

  it('still applies the chosen order within the pinned group', () => {
    const list = [
      worktree('master', { date: '2026-01-01T00:00:00Z' }),
      worktree('main', { date: '2026-08-01T00:00:00Z' }),
      worktree('feature', { date: '2026-12-01T00:00:00Z' })
    ]

    expect(names(sortWorktrees(list, 'recently-updated', true))).toEqual([
      'main',
      'master',
      'feature'
    ])
  })

  it('sorts a detached worktree under the label the row shows for it', () => {
    const list = [worktree('zeta'), worktree(null, { head: 'abc1234def' })]

    expect(sortWorktrees(list, 'alphabetical', false).map((w) => w.branch)).toEqual([null, 'zeta'])
  })

  it('leaves the input array alone', () => {
    const list = [worktree('zeta'), worktree('alpha')]
    sortWorktrees(list, 'alphabetical', false)

    expect(names(list)).toEqual(['zeta', 'alpha'])
  })
})

describe('sortRemoteBranches', () => {
  it('sorts alphabetically by full ref name', () => {
    const list = [remote('origin/zeta'), remote('origin/alpha')]

    expect(sortRemoteBranches(list, 'alphabetical').map((b) => b.name)).toEqual([
      'origin/alpha',
      'origin/zeta'
    ])
  })

  it('sorts by tip commit date, newest first, with undated last', () => {
    const list = [
      remote('origin/undated'),
      remote('origin/old', '2026-01-01T00:00:00Z'),
      remote('origin/new', '2026-08-01T00:00:00Z')
    ]

    expect(sortRemoteBranches(list, 'recently-updated').map((b) => b.shortName)).toEqual([
      'new',
      'old',
      'undated'
    ])
  })
})

describe('filterWorktrees', () => {
  const list = [
    worktree('feature/JIRA-4021-thing'),
    worktree('main', { isMain: true, path: '/repo' }),
    worktree('release/1.0')
  ]

  it('matches a substring anywhere in the branch name, not only a prefix', () => {
    expect(names(filterWorktrees(list, 'JIRA-4021'))).toEqual(['feature/JIRA-4021-thing'])
  })

  it('ignores case', () => {
    expect(names(filterWorktrees(list, 'jira'))).toEqual(['feature/JIRA-4021-thing'])
  })

  it('matches on the path as well as the branch', () => {
    expect(names(filterWorktrees(list, '/repo/release'))).toEqual(['release/1.0'])
  })

  it('matches everything for an empty or whitespace-only query', () => {
    expect(filterWorktrees(list, '')).toHaveLength(3)
    expect(filterWorktrees(list, '   ')).toHaveLength(3)
  })

  it('matches nothing when nothing matches, rather than falling back to everything', () => {
    expect(filterWorktrees(list, 'nothing-like-this')).toEqual([])
  })
})

describe('filterRemoteBranches', () => {
  const list = [remote('origin/feature-x'), remote('upstream/main')]

  it('matches the short name as well as the full ref', () => {
    expect(filterRemoteBranches(list, 'feature-x').map((b) => b.name)).toEqual(['origin/feature-x'])
  })

  it('matches the remote prefix, which only the full ref carries', () => {
    expect(filterRemoteBranches(list, 'upstream').map((b) => b.name)).toEqual(['upstream/main'])
  })
})
