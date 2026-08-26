import { describe, it, expect } from 'vitest'
import {
  FIELD_SEPARATOR,
  LOG_FIELD_SEPARATOR,
  LOG_RECORD_SEPARATOR,
  parseAheadBehind,
  parseBranchList,
  parseCommit,
  parseCommitLog,
  parseRemoteBranchList,
  parseStashList,
  parseStatus,
  parseUpstreamTrack,
  parseWorktreeList
} from '../../src/main/services/git/porcelain'

describe('parseWorktreeList', () => {
  it('parses a repository with one worktree', () => {
    const output = [
      'worktree /Users/iso/code/arborist',
      'HEAD abc123',
      'branch refs/heads/main',
      ''
    ]

    // Explicit platform, because the parser normalises separators to the one
    // the host uses and these assertions are about POSIX paths.
    expect(parseWorktreeList(output.join('\n'), 'darwin')).toEqual([
      {
        path: '/Users/iso/code/arborist',
        head: 'abc123',
        branch: 'main',
        isMain: true,
        isBare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null
      }
    ])
  })

  it('treats the first stanza as the main worktree, and only the first', () => {
    const output = [
      'worktree /code/arborist',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /code/feature-x',
      'HEAD bbb',
      'branch refs/heads/feature/x',
      ''
    ].join('\n')

    expect(parseWorktreeList(output, 'darwin').map((w) => [w.branch, w.isMain])).toEqual([
      ['main', true],
      ['feature/x', false]
    ])
  })

  it('keeps spaces in worktree paths', () => {
    const output = 'worktree /Users/iso/My Code/arborist wt\nHEAD aaa\nbranch refs/heads/main\n'

    expect(parseWorktreeList(output, 'darwin')[0].path).toBe('/Users/iso/My Code/arborist wt')
  })

  it('reads a detached HEAD as a null branch', () => {
    const output = 'worktree /code/x\nHEAD aaa\ndetached\n'

    expect(parseWorktreeList(output)[0]).toMatchObject({ branch: null, head: 'aaa' })
  })

  it('reads locked with and without a reason', () => {
    const output = [
      'worktree /code/a',
      'HEAD aaa',
      'branch refs/heads/a',
      'locked',
      '',
      'worktree /code/b',
      'HEAD bbb',
      'branch refs/heads/b',
      'locked on an external drive',
      ''
    ].join('\n')

    expect(parseWorktreeList(output).map((w) => [w.locked, w.lockReason])).toEqual([
      [true, null],
      [true, 'on an external drive']
    ])
  })

  it('reads prunable with its reason', () => {
    const output =
      'worktree /code/gone\nHEAD aaa\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location\n'

    expect(parseWorktreeList(output)[0]).toMatchObject({
      prunable: true,
      prunableReason: 'gitdir file points to non-existent location'
    })
  })

  it('reads a bare repository, which has no HEAD line', () => {
    const output = 'worktree /code/arborist.git\nbare\n'

    expect(parseWorktreeList(output)[0]).toMatchObject({
      isBare: true,
      isMain: true,
      head: null,
      branch: null
    })
  })

  it('handles CRLF output and a missing trailing blank line', () => {
    const output = 'worktree C:\\code\\arborist\r\nHEAD aaa\r\nbranch refs/heads/main'

    expect(parseWorktreeList(output, 'win32')).toHaveLength(1)
    expect(parseWorktreeList(output, 'win32')[0]).toMatchObject({
      path: 'C:\\code\\arborist',
      branch: 'main'
    })
  })

  it('returns nothing for empty output', () => {
    expect(parseWorktreeList('')).toEqual([])
  })
})

describe('parseBranchList', () => {
  it('marks the branch carrying the trailing star as current', () => {
    expect(parseBranchList('main*\nfeature/x\nrelease/1.0\n')).toEqual([
      { name: 'main', current: true },
      { name: 'feature/x', current: false },
      { name: 'release/1.0', current: false }
    ])
  })

  it('ignores blank lines', () => {
    expect(parseBranchList('\n\nmain\n\n')).toEqual([{ name: 'main', current: false }])
  })
})

describe('parseRemoteBranchList', () => {
  it('drops the symbolic HEAD entries', () => {
    const output = 'origin/HEAD\norigin/main\norigin/feature/x\nupstream/HEAD\nupstream/main\n'

    expect(parseRemoteBranchList(output)).toEqual([
      'origin/main',
      'origin/feature/x',
      'upstream/main'
    ])
  })

  it('keeps a branch merely ending in the word HEAD', () => {
    expect(parseRemoteBranchList('origin/fix-HEAD-parsing\n')).toEqual(['origin/fix-HEAD-parsing'])
  })

  it('drops a bare remote name with no slash, as git 2.55 prints for the symbolic HEAD ref on some setups', () => {
    const output = 'origin\norigin/main\norigin/feature/x\n'

    expect(parseRemoteBranchList(output)).toEqual(['origin/main', 'origin/feature/x'])
  })
})

describe('parseAheadBehind', () => {
  it('reads ahead from the left count and behind from the right', () => {
    expect(parseAheadBehind('2\t1\n')).toEqual({ ahead: 2, behind: 1 })
  })

  it('reads a branch in sync', () => {
    expect(parseAheadBehind('0\t0\n')).toEqual({ ahead: 0, behind: 0 })
  })

  it('returns null when there is no upstream to compare against', () => {
    expect(parseAheadBehind('')).toBeNull()
    expect(parseAheadBehind('fatal: no upstream configured')).toBeNull()
  })
})

describe('parseStatus', () => {
  it('counts a clean tree as clean', () => {
    expect(parseStatus('')).toEqual({ dirty: false, staged: 0, unstaged: 0, untracked: 0 })
  })

  it('separates staged, unstaged and untracked changes', () => {
    const output = ['M  staged.ts', ' M unstaged.ts', 'MM both.ts', '?? new.ts'].join('\n')

    expect(parseStatus(output)).toEqual({ dirty: true, staged: 2, unstaged: 2, untracked: 1 })
  })

  it('counts a rename as staged', () => {
    expect(parseStatus('R  old.ts -> new.ts')).toMatchObject({ dirty: true, staged: 1 })
  })
})

describe('parseUpstreamTrack', () => {
  it('reads both counts', () => {
    expect(parseUpstreamTrack('[ahead 2, behind 1]')).toEqual({ ahead: 2, behind: 1, gone: false })
  })

  it('reads one-sided divergence', () => {
    expect(parseUpstreamTrack('[ahead 3]')).toEqual({ ahead: 3, behind: 0, gone: false })
    expect(parseUpstreamTrack('[behind 4]')).toEqual({ ahead: 0, behind: 4, gone: false })
  })

  it('reads a branch in sync, which git reports as nothing at all', () => {
    expect(parseUpstreamTrack('')).toEqual({ ahead: 0, behind: 0, gone: false })
  })

  it('reads a deleted upstream', () => {
    expect(parseUpstreamTrack('[gone]')).toEqual({ ahead: 0, behind: 0, gone: true })
  })
})

describe('parseCommit', () => {
  const fields = (...values: string[]): string => values.join(FIELD_SEPARATOR)

  it('reads every field', () => {
    const output = fields(
      '46862b9c0f0e1a2b3c4d5e6f708192a3b4c5d6e7',
      '46862b9',
      'Isaac Shea',
      '2026-08-20T14:00:00+10:00',
      'Updated nearby and station routes'
    )

    expect(parseCommit(`${output}\n`)).toEqual({
      hash: '46862b9c0f0e1a2b3c4d5e6f708192a3b4c5d6e7',
      shortHash: '46862b9',
      author: 'Isaac Shea',
      date: '2026-08-20T14:00:00+10:00',
      subject: 'Updated nearby and station routes'
    })
  })

  it('keeps a subject containing the characters a naive separator would break on', () => {
    const output = fields(
      'aaa',
      'aaa',
      'Isaac Shea',
      '2026-08-20T14:00:00Z',
      'Fix: tabs\tand | pipes'
    )

    expect(parseCommit(output)?.subject).toBe('Fix: tabs\tand | pipes')
  })

  it('returns null for an empty log, as in a repository with no commits', () => {
    expect(parseCommit('')).toBeNull()
  })
})

describe('parseCommitLog', () => {
  function record(
    fields: [hash: string, shortHash: string, author: string, date: string, subject: string],
    shortstat = ''
  ): string {
    const header = fields.join(LOG_FIELD_SEPARATOR)
    return shortstat
      ? `${LOG_RECORD_SEPARATOR}${header}\n\n ${shortstat}\n`
      : `${LOG_RECORD_SEPARATOR}${header}\n`
  }

  it('reads every field, newest first', () => {
    const output =
      record(['aaa', 'aaa1234', 'Isaac Shea', '2026-08-20T14:00:00+10:00', 'First'], '') +
      record(['bbb', 'bbb1234', 'Isaac Shea', '2026-08-19T09:00:00+10:00', 'Second'], '')

    expect(parseCommitLog(output)).toEqual([
      {
        hash: 'aaa',
        shortHash: 'aaa1234',
        author: 'Isaac Shea',
        date: '2026-08-20T14:00:00+10:00',
        subject: 'First',
        filesChanged: 0,
        insertions: 0,
        deletions: 0
      },
      {
        hash: 'bbb',
        shortHash: 'bbb1234',
        author: 'Isaac Shea',
        date: '2026-08-19T09:00:00+10:00',
        subject: 'Second',
        filesChanged: 0,
        insertions: 0,
        deletions: 0
      }
    ])
  })

  it('keeps a subject containing quotes and pipes', () => {
    const output = record(
      ['aaa', 'aaa1234', 'Isaac Shea', '2026-08-20T14:00:00Z', 'Fix: "quoted" | piped'],
      '1 file changed, 1 insertion(+)'
    )

    expect(parseCommitLog(output)[0].subject).toBe('Fix: "quoted" | piped')
  })

  it('splits records correctly when the separator sits right against a newline', () => {
    const output = `${LOG_RECORD_SEPARATOR}aaa${LOG_FIELD_SEPARATOR}aaa1234${LOG_FIELD_SEPARATOR}Isaac Shea${LOG_FIELD_SEPARATOR}2026-08-20T14:00:00Z${LOG_FIELD_SEPARATOR}One\n${LOG_RECORD_SEPARATOR}bbb${LOG_FIELD_SEPARATOR}bbb1234${LOG_FIELD_SEPARATOR}Isaac Shea${LOG_FIELD_SEPARATOR}2026-08-19T14:00:00Z${LOG_FIELD_SEPARATOR}Two\n`

    expect(parseCommitLog(output).map((c) => c.hash)).toEqual(['aaa', 'bbb'])
  })

  it.each([
    ['both counts', '3 files changed, 10 insertions(+), 2 deletions(-)', 3, 10, 2],
    ['no insertions', '2 files changed, 3 deletions(-)', 2, 0, 3],
    ['no deletions', '1 file changed, 4 insertions(+)', 1, 4, 0],
    ['neither', '1 file changed', 1, 0, 0]
  ])('reads a shortstat with %s', (_name, shortstat, filesChanged, insertions, deletions) => {
    const output = record(
      ['aaa', 'aaa1234', 'Isaac Shea', '2026-08-20T14:00:00Z', 'Change'],
      shortstat
    )

    expect(parseCommitLog(output)[0]).toMatchObject({ filesChanged, insertions, deletions })
  })

  it('defaults every count to zero for a commit with no shortstat at all', () => {
    const output = record(['aaa', 'aaa1234', 'Isaac Shea', '2026-08-20T14:00:00Z', 'Empty'])

    expect(parseCommitLog(output)[0]).toMatchObject({
      filesChanged: 0,
      insertions: 0,
      deletions: 0
    })
  })

  it('returns nothing for a repository with no commits', () => {
    expect(parseCommitLog('')).toEqual([])
  })
})

describe('parseStashList', () => {
  it('parses git stash list --format=%gd%x00%s%x00%aI', () => {
    const output = [
      `stash@{0}${FIELD_SEPARATOR}Arborist: switching to feature-x${FIELD_SEPARATOR}2026-08-20T14:00:00+00:00`,
      `stash@{1}${FIELD_SEPARATOR}WIP on main: aaa1234 Initial commit${FIELD_SEPARATOR}2026-08-19T09:00:00+00:00`
    ].join('\n')

    expect(parseStashList(output)).toEqual([
      {
        ref: 'stash@{0}',
        message: 'Arborist: switching to feature-x',
        date: '2026-08-20T14:00:00+00:00'
      },
      {
        ref: 'stash@{1}',
        message: 'WIP on main: aaa1234 Initial commit',
        date: '2026-08-19T09:00:00+00:00'
      }
    ])
  })

  it('returns nothing for an empty stash', () => {
    expect(parseStashList('')).toEqual([])
  })
})
