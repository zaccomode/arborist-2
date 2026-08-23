import { describe, it, expect } from 'vitest'
import { FIELD_SEPARATOR, countsFromV2, parseStatusV2 } from '../../src/main/services/git/porcelain'
import type { WorkingTreeChanges } from '../../src/shared/domain'

/** Joins records the way `-z` output does: every record NUL-terminated, including the last. */
function statusOutput(...records: string[]): string {
  return records.map((record) => `${record}${FIELD_SEPARATOR}`).join('')
}

describe('parseStatusV2', () => {
  it('parses an ordinary modified-in-worktree record', () => {
    const output = statusOutput(
      '# branch.oid abc123',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 aaa aaa file.txt'
    )

    const result = parseStatusV2(output)

    expect(result.branch).toEqual({
      oid: 'abc123',
      head: 'main',
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0
    })
    expect(result.files).toEqual([
      {
        path: 'file.txt',
        kind: 'tracked',
        index: '.',
        worktree: 'M',
        origPath: null,
        score: null,
        conflict: null,
        submodule: null
      }
    ])
  })

  it('parses branch.upstream and branch.ab', () => {
    const output = statusOutput(
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1'
    )

    expect(parseStatusV2(output).branch).toMatchObject({
      upstream: 'origin/main',
      ahead: 2,
      behind: 1
    })
  })

  it('resolves "(initial)" to a null oid, at a branch with no commits yet', () => {
    const output = statusOutput('# branch.oid (initial)', '# branch.head main')

    expect(parseStatusV2(output).branch).toMatchObject({ oid: null, head: 'main', detached: false })
  })

  it('resolves "(detached)" to a null head, detached true', () => {
    const output = statusOutput('# branch.oid abc123', '# branch.head (detached)')

    expect(parseStatusV2(output).branch).toMatchObject({ head: null, detached: true })
  })

  it('parses a rename record: the original path is a second, separate NUL field', () => {
    // Verified shape from git 2.54: a `2` record is NUL-terminated after the
    // new path, and the original path follows as its own NUL-terminated
    // field. A naive `.split('\0').filter(Boolean)` would emit "a file.txt"
    // below as a bogus record of its own.
    const output = statusOutput(
      '2 RM N... 100644 100644 100644 814f4a42 814f4a42 R100 renamed file.txt',
      'a file.txt'
    )

    expect(parseStatusV2(output).files).toEqual([
      {
        path: 'renamed file.txt',
        kind: 'tracked',
        index: 'R',
        worktree: 'M',
        origPath: 'a file.txt',
        score: 100,
        conflict: null,
        submodule: null
      }
    ])
  })

  it('parses an AA unmerged record whose stage-1 mode and hash are absent', () => {
    // An AA (both added) conflict has no common ancestor, so stage 1's mode
    // is 000000 with an all-zero hash — the parser must not assume all three
    // stages exist.
    const output = statusOutput(
      'u AA N... 000000 100644 100644 100644 ' +
        '0000000000000000000000000000000000000000 ' +
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ' +
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb conflict.txt'
    )

    expect(parseStatusV2(output).files).toEqual([
      {
        path: 'conflict.txt',
        kind: 'unmerged',
        index: '.',
        worktree: '.',
        origPath: null,
        score: null,
        conflict: 'AA',
        submodule: null
      }
    ])
  })

  it('parses every unmerged code', () => {
    const codes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']
    const output = statusOutput(
      ...codes.map(
        (code, i) => `u ${code} N... 100644 100644 100644 100644 aaa bbb ccc file-${i}.txt`
      )
    )

    expect(parseStatusV2(output).files.map((f) => f.conflict)).toEqual(codes)
  })

  it('parses a submodule field', () => {
    const output = statusOutput('1 .M S.M. 160000 160000 160000 aaa bbb sub')

    expect(parseStatusV2(output).files[0]?.submodule).toEqual({
      commitChanged: false,
      modifiedTracked: true,
      untracked: false
    })
  })

  it('parses untracked and ignored records', () => {
    const output = statusOutput('? new-file.txt', '! ignored-file.txt')

    expect(parseStatusV2(output).files).toEqual([
      {
        path: 'new-file.txt',
        kind: 'untracked',
        index: '.',
        worktree: '.',
        origPath: null,
        score: null,
        conflict: null,
        submodule: null
      },
      {
        path: 'ignored-file.txt',
        kind: 'ignored',
        index: '.',
        worktree: '.',
        origPath: null,
        score: null,
        conflict: null,
        submodule: null
      }
    ])
  })

  it('keeps spaces in paths intact', () => {
    const output = statusOutput('1 M. N... 100644 100644 100644 aaa aaa a file with spaces.txt')

    expect(parseStatusV2(output).files[0]?.path).toBe('a file with spaces.txt')
  })

  it('returns an empty file list and default branch info for no output', () => {
    expect(parseStatusV2('')).toEqual({
      branch: { oid: null, head: null, detached: false, upstream: null, ahead: 0, behind: 0 },
      files: []
    })
  })
})

describe('countsFromV2', () => {
  const base: WorkingTreeChanges['files'][number] = {
    path: '',
    kind: 'tracked',
    index: '.',
    worktree: '.',
    origPath: null,
    score: null,
    conflict: null,
    submodule: null
  }

  const branch: WorkingTreeChanges['branch'] = {
    oid: 'abc',
    head: 'main',
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0
  }

  it('counts a staged file, an unstaged file, and an untracked file separately', () => {
    const changes: WorkingTreeChanges = {
      branch,
      files: [
        { ...base, path: 'staged.txt', index: 'M' },
        { ...base, path: 'unstaged.txt', worktree: 'M' },
        { ...base, path: 'untracked.txt', kind: 'untracked' }
      ]
    }

    expect(countsFromV2(changes)).toEqual({ dirty: true, staged: 1, unstaged: 1, untracked: 1 })
  })

  it('counts a partially staged file (MM) toward both staged and unstaged', () => {
    const changes: WorkingTreeChanges = {
      branch,
      files: [{ ...base, path: 'both.txt', index: 'M', worktree: 'M' }]
    }

    expect(countsFromV2(changes)).toEqual({ dirty: true, staged: 1, unstaged: 1, untracked: 0 })
  })

  it('counts an unmerged file toward both staged and unstaged, matching v1', () => {
    const changes: WorkingTreeChanges = {
      branch,
      files: [{ ...base, path: 'conflict.txt', kind: 'unmerged', conflict: 'UU' }]
    }

    expect(countsFromV2(changes)).toEqual({ dirty: true, staged: 1, unstaged: 1, untracked: 0 })
  })

  it('ignores ignored files entirely', () => {
    const changes: WorkingTreeChanges = {
      branch,
      files: [{ ...base, path: 'ignored.txt', kind: 'ignored' }]
    }

    expect(countsFromV2(changes)).toEqual({ dirty: false, staged: 0, unstaged: 0, untracked: 0 })
  })

  it('is not dirty with no files', () => {
    expect(countsFromV2({ branch, files: [] })).toEqual({
      dirty: false,
      staged: 0,
      unstaged: 0,
      untracked: 0
    })
  })
})
