import { describe, it, expect } from 'vitest'
import {
  diffSideFor,
  isInspectable,
  pushLabel,
  sortChangedFiles,
  splitDisplayPath,
  stagedFileCount,
  stagePathsFor,
  stagingState,
  stashScope,
  statusKind,
  statusLabel
} from '@shared/working-tree'
import type { ChangedFile } from '@shared/domain'

function file(overrides: Partial<ChangedFile>): ChangedFile {
  return {
    path: 'a.txt',
    kind: 'tracked',
    index: '.',
    worktree: '.',
    origPath: null,
    score: null,
    conflict: null,
    submodule: null,
    ...overrides
  }
}

describe('stagingState', () => {
  it('is unchecked when nothing is staged', () => {
    expect(stagingState(file({ worktree: 'M' }))).toBe('unchecked')
  })

  it('is checked when the index side alone has a change', () => {
    expect(stagingState(file({ index: 'A' }))).toBe('checked')
  })

  it('is indeterminate for a file staged and unstaged at once', () => {
    expect(stagingState(file({ index: 'M', worktree: 'M' }))).toBe('indeterminate')
  })

  it('is unchecked for an untracked file', () => {
    expect(stagingState(file({ kind: 'untracked' }))).toBe('unchecked')
  })

  it('is indeterminate for an unmerged file, regardless of its conflict code', () => {
    expect(stagingState(file({ kind: 'unmerged', conflict: 'UU' }))).toBe('indeterminate')
  })
})

describe('statusLabel', () => {
  it('reads like git status --short for a tracked file', () => {
    expect(statusLabel(file({ worktree: 'M' }))).toBe(' M')
    expect(statusLabel(file({ index: 'A' }))).toBe('A ')
    expect(statusLabel(file({ index: 'M', worktree: 'M' }))).toBe('MM')
  })

  it('marks an untracked file with ??', () => {
    expect(statusLabel(file({ kind: 'untracked' }))).toBe('??')
  })

  it('marks an ignored file with !!', () => {
    expect(statusLabel(file({ kind: 'ignored' }))).toBe('!!')
  })

  it('shows the raw conflict code for an unmerged file', () => {
    expect(statusLabel(file({ kind: 'unmerged', conflict: 'AA' }))).toBe('AA')
  })
})

describe('statusKind', () => {
  it('categorises an untracked or added file as added', () => {
    expect(statusKind(file({ kind: 'untracked' }))).toBe('added')
    expect(statusKind(file({ index: 'A' }))).toBe('added')
  })

  it('categorises a modified file as modified', () => {
    expect(statusKind(file({ worktree: 'M' }))).toBe('modified')
  })

  it('categorises a deleted file as deleted', () => {
    expect(statusKind(file({ worktree: 'D' }))).toBe('deleted')
  })

  it('categorises a rename or copy as renamed', () => {
    expect(statusKind(file({ index: 'R' }))).toBe('renamed')
    expect(statusKind(file({ index: 'C' }))).toBe('renamed')
  })

  it('categorises an unmerged file as a conflict', () => {
    expect(statusKind(file({ kind: 'unmerged', conflict: 'UU' }))).toBe('conflict')
  })

  it('mutes an ignored file', () => {
    expect(statusKind(file({ kind: 'ignored' }))).toBe('muted')
  })

  it('prefers added over a second, less surprising change on the same file', () => {
    expect(statusKind(file({ index: 'A', worktree: 'M' }))).toBe('added')
  })
})

describe('isInspectable', () => {
  it('is false only for an unmerged file', () => {
    expect(isInspectable(file({ kind: 'unmerged', conflict: 'UU' }))).toBe(false)
    expect(isInspectable(file({ kind: 'tracked' }))).toBe(true)
    expect(isInspectable(file({ kind: 'untracked' }))).toBe(true)
  })
})

describe('diffSideFor', () => {
  it('opens untracked for an untracked file', () => {
    expect(diffSideFor(file({ kind: 'untracked' }))).toBe('untracked')
  })

  it('opens unstaged when only the worktree side has a change', () => {
    expect(diffSideFor(file({ worktree: 'M' }))).toBe('unstaged')
  })

  it('opens staged when the index side has a change', () => {
    expect(diffSideFor(file({ index: 'A' }))).toBe('staged')
  })

  it('prefers staged for a file staged and unstaged at once', () => {
    expect(diffSideFor(file({ index: 'M', worktree: 'M' }))).toBe('staged')
  })
})

describe('stagePathsFor', () => {
  it('is just the path for an ordinary file', () => {
    expect(stagePathsFor(file({ path: 'a.txt' }))).toEqual(['a.txt'])
  })

  it('includes both sides for a rename', () => {
    expect(stagePathsFor(file({ path: 'new.txt', origPath: 'old.txt' }))).toEqual([
      'old.txt',
      'new.txt'
    ])
  })
})

describe('sortChangedFiles', () => {
  it('orders files alphabetically by path, ignoring their status grouping', () => {
    const files = [
      file({ path: 'z.txt', kind: 'untracked' }),
      file({ path: 'a.txt', worktree: 'M' }),
      file({ path: 'm.txt', index: 'A' })
    ]
    expect(sortChangedFiles(files).map((f) => f.path)).toEqual(['a.txt', 'm.txt', 'z.txt'])
  })

  it('does not mutate the input array', () => {
    const files = [file({ path: 'b.txt' }), file({ path: 'a.txt' })]
    sortChangedFiles(files)
    expect(files.map((f) => f.path)).toEqual(['b.txt', 'a.txt'])
  })
})

describe('stagedFileCount', () => {
  it('counts files with an index-side change', () => {
    const files = [file({ path: 'a.txt', index: 'A' }), file({ path: 'b.txt', worktree: 'M' })]
    expect(stagedFileCount(files)).toBe(1)
  })

  it('excludes an unmerged file even though it has no unchanged side', () => {
    expect(stagedFileCount([file({ kind: 'unmerged', conflict: 'UU' })])).toBe(0)
  })
})

describe('pushLabel', () => {
  it('counts commits ahead when there is an upstream', () => {
    expect(pushLabel(1, true)).toBe('Push 1 commit')
    expect(pushLabel(2, true)).toBe('Push 2 commits')
  })

  it('offers to publish when there is no upstream, regardless of ahead', () => {
    expect(pushLabel(0, false)).toBe('Publish branch')
  })
})

describe('stashScope', () => {
  it('falls back to stashing everything when nothing is checked for staging', () => {
    const files = [
      file({ path: 'a.txt', worktree: 'M' }),
      file({ path: 'b.txt', kind: 'untracked' })
    ]
    expect(stashScope(files)).toEqual({ files: [], paths: null })
  })

  it('scopes to the checked files alone, leaving the rest out of the pathspec', () => {
    const files = [
      file({ path: 'a.txt', index: 'A' }),
      file({ path: 'b.txt', worktree: 'M' }),
      file({ path: 'c.txt', kind: 'untracked' })
    ]
    const scope = stashScope(files)
    expect(scope.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(scope.paths).toEqual(['a.txt'])
  })

  it('counts an indeterminate (partially staged) file as checked', () => {
    const files = [file({ path: 'a.txt', index: 'M', worktree: 'M' })]
    expect(stashScope(files)).toEqual({ files, paths: ['a.txt'] })
  })

  it('carries both sides of a checked rename into the pathspec', () => {
    const files = [file({ path: 'new.txt', origPath: 'old.txt', index: 'R' })]
    expect(stashScope(files).paths).toEqual(['old.txt', 'new.txt'])
  })

  it('never selects an unmerged file, even though stagingState reports it as indeterminate', () => {
    const files = [file({ kind: 'unmerged', conflict: 'UU' })]
    expect(stashScope(files)).toEqual({ files: [], paths: null })
  })
})

describe('splitDisplayPath', () => {
  it('splits a nested path into its name and directory', () => {
    expect(splitDisplayPath('src/components/button.tsx')).toEqual({
      name: 'button.tsx',
      dir: 'src/components'
    })
  })

  it('has no directory for a root-level file', () => {
    expect(splitDisplayPath('README.md')).toEqual({ name: 'README.md', dir: '' })
  })
})
