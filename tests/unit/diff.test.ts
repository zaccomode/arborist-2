import { describe, it, expect } from 'vitest'
import {
  diffRequestIdentity,
  diffStats,
  isHunklessChange,
  isPatchHeaderLine,
  parseUnifiedDiff,
  syntheticNewFileDiff,
  truncateFileDiff,
  wholeFilePathsFor,
  withDiffSide,
  type DiffHunk,
  type DiffRequest,
  type FileDiff
} from '@shared/diff'

function hunkOfLines(count: number): DiffHunk {
  return {
    header: `@@ -1,${count} +1,${count} @@`,
    oldStart: 1,
    oldLines: count,
    newStart: 1,
    newLines: count,
    lines: Array.from({ length: count }, (_, index) => ({
      kind: 'add' as const,
      text: `line ${index}`,
      oldLine: null,
      newLine: index + 1
    })),
    lineRange: { start: 0, end: count - 1 }
  }
}

function emptyFileDiff(hunks: DiffHunk[]): FileDiff {
  return {
    oldPath: 'f.txt',
    newPath: 'f.txt',
    changeKind: 'modified',
    oldMode: null,
    newMode: null,
    similarity: null,
    binary: false,
    hunks
  }
}

describe('parseUnifiedDiff', () => {
  it('parses a plain modified file with one hunk', () => {
    const text = [
      'diff --git a/f.txt b/f.txt',
      'index abc123..def456 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@',
      ' line1',
      '-line2',
      '+line2 changed',
      ' line3'
    ].join('\n')

    const [file] = parseUnifiedDiff(text)

    expect(file).toMatchObject({
      oldPath: 'f.txt',
      newPath: 'f.txt',
      changeKind: 'modified',
      binary: false
    })
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 })
    expect(file.hunks[0].lines).toEqual([
      { kind: 'context', text: 'line1', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'line2', oldLine: 2, newLine: null },
      { kind: 'add', text: 'line2 changed', oldLine: null, newLine: 2 },
      { kind: 'context', text: 'line3', oldLine: 3, newLine: 3 }
    ])
  })

  it('produces no hunks for a mode-only change', () => {
    const text = ['diff --git a/script.sh b/script.sh', 'old mode 100644', 'new mode 100755'].join(
      '\n'
    )

    const [file] = parseUnifiedDiff(text)

    expect(file).toMatchObject({
      changeKind: 'mode-change',
      oldMode: '100644',
      newMode: '100755',
      oldPath: 'script.sh',
      newPath: 'script.sh'
    })
    expect(file.hunks).toEqual([])
  })

  it('parses a new file with /dev/null on the old side', () => {
    const text = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..abcdef1',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+line1',
      '+line2'
    ].join('\n')

    const [file] = parseUnifiedDiff(text)

    expect(file).toMatchObject({ oldPath: null, newPath: 'new.txt', changeKind: 'added' })
    expect(file.hunks[0].lines.map((line) => line.kind)).toEqual(['add', 'add'])
  })

  it('parses a deleted file with /dev/null on the new side', () => {
    const text = [
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      'index abcdef1..0000000',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line1',
      '-line2'
    ].join('\n')

    const [file] = parseUnifiedDiff(text)

    expect(file).toMatchObject({ oldPath: 'gone.txt', newPath: null, changeKind: 'deleted' })
  })

  it('reads a rename with its similarity and real hunks', () => {
    const text = [
      'diff --git a/old.txt b/new.txt',
      'similarity index 92%',
      'rename from old.txt',
      'rename to new.txt',
      'index abc123..def456 100644',
      '--- a/old.txt',
      '+++ b/new.txt',
      '@@ -1,3 +1,3 @@',
      ' line1',
      '-line2',
      '+line2 changed',
      ' line3'
    ].join('\n')

    const [file] = parseUnifiedDiff(text)

    expect(file).toMatchObject({
      oldPath: 'old.txt',
      newPath: 'new.txt',
      changeKind: 'renamed',
      similarity: 92
    })
    expect(file.hunks).toHaveLength(1)
  })

  it('marks a binary file with no hunks', () => {
    const text = [
      'diff --git a/image.png b/image.png',
      'index abc123..def456 100644',
      'Binary files a/image.png and b/image.png differ'
    ].join('\n')

    const [file] = parseUnifiedDiff(text)

    expect(file).toMatchObject({ binary: true })
    expect(file.hunks).toEqual([])
  })

  it('attaches a no-newline marker to both sides of one hunk', () => {
    const text = [
      'diff --git a/f.txt b/f.txt',
      'index abc123..def456 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-old content',
      '\\ No newline at end of file',
      '+new content',
      '\\ No newline at end of file'
    ].join('\n')

    const [file] = parseUnifiedDiff(text)

    expect(file.hunks[0].lines.map((line) => line.kind)).toEqual([
      'remove',
      'no-newline',
      'add',
      'no-newline'
    ])
  })

  it('defaults omitted hunk-header counts to 1', () => {
    const text = [
      'diff --git a/f.txt b/f.txt',
      'index abc123..def456 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1,2 @@',
      ' line1',
      '+line2'
    ].join('\n')

    const [file] = parseUnifiedDiff(text)

    expect(file.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 })
  })

  it('parses more than one file from a single diff', () => {
    const text = [
      'diff --git a/a.txt b/a.txt',
      'index 111..222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-a',
      '+A',
      'diff --git a/b.txt b/b.txt',
      'index 333..444 100644',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-b',
      '+B'
    ].join('\n')

    const files = parseUnifiedDiff(text)

    expect(files.map((file) => file.newPath)).toEqual(['a.txt', 'b.txt'])
  })

  it('records a hunk lineRange spanning its header through its last body line', () => {
    const text = [
      'diff --git a/f.txt b/f.txt',
      'index 111..222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-a',
      '+A'
    ].join('\n')

    const [file] = parseUnifiedDiff(text)

    // Lines are 0-indexed: 0=diff --git, 1=index, 2=---, 3=+++, 4=@@, 5=-a, 6=+A
    expect(file.hunks[0].lineRange).toEqual({ start: 4, end: 6 })
  })
})

describe('syntheticNewFileDiff', () => {
  it('renders every line of the file as an addition', () => {
    const file = syntheticNewFileDiff('new.txt', 'line1\nline2\n')

    expect(file).toMatchObject({
      oldPath: null,
      newPath: 'new.txt',
      changeKind: 'added',
      binary: false
    })
    expect(file.hunks[0].lines).toEqual([
      { kind: 'add', text: 'line1', oldLine: null, newLine: 1 },
      { kind: 'add', text: 'line2', oldLine: null, newLine: 2 }
    ])
  })

  it('appends a no-newline marker when the file has no trailing newline', () => {
    const file = syntheticNewFileDiff('new.txt', 'line1')

    expect(file.hunks[0].lines).toEqual([
      { kind: 'add', text: 'line1', oldLine: null, newLine: 1 },
      { kind: 'no-newline', text: 'No newline at end of file', oldLine: null, newLine: null }
    ])
  })

  it('marks a binary file with no hunks and no content read', () => {
    const file = syntheticNewFileDiff('image.png', null)

    expect(file).toMatchObject({ binary: true, hunks: [] })
  })

  it('has no hunks for an empty file', () => {
    const file = syntheticNewFileDiff('empty.txt', '')

    expect(file.hunks).toEqual([])
  })
})

describe('diffStats', () => {
  it('counts additions and deletions across every hunk, ignoring context and markers', () => {
    const text = [
      'diff --git a/f.txt b/f.txt',
      'index 111..222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,2 +1,2 @@',
      ' context',
      '-removed',
      '+added',
      '\\ No newline at end of file'
    ].join('\n')
    const [file] = parseUnifiedDiff(text)

    expect(diffStats(file)).toEqual({ insertions: 1, deletions: 1 })
  })

  it('is zero for a mode-only change with no hunks', () => {
    expect(diffStats(emptyFileDiff([]))).toEqual({ insertions: 0, deletions: 0 })
  })
})

describe('truncateFileDiff', () => {
  it('leaves a diff under the cap untouched', () => {
    const file = emptyFileDiff([hunkOfLines(10)])

    expect(truncateFileDiff(file)).toBe(file)
  })

  it('drops a hunk that would start past the cap entirely', () => {
    const file = emptyFileDiff([hunkOfLines(2000), hunkOfLines(500)])

    const result = truncateFileDiff(file)

    expect(result.truncated).toBe(true)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].lines).toHaveLength(2000)
  })

  it('cuts a hunk short mid-hunk when the cap falls inside it', () => {
    const file = emptyFileDiff([hunkOfLines(1000), hunkOfLines(1500)])

    const result = truncateFileDiff(file)

    expect(result.truncated).toBe(true)
    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[0].lines).toHaveLength(1000)
    expect(result.hunks[1].lines).toHaveLength(1000)
  })
})

describe('isHunklessChange', () => {
  it('is true for a binary file even if hunks were somehow present', () => {
    expect(isHunklessChange({ ...emptyFileDiff([]), binary: true })).toBe(true)
  })

  it('is true for a mode-only change', () => {
    expect(isHunklessChange({ ...emptyFileDiff([]), changeKind: 'mode-change' })).toBe(true)
  })

  it('is true for a pure rename with no content edit', () => {
    expect(isHunklessChange({ ...emptyFileDiff([]), changeKind: 'renamed' })).toBe(true)
  })

  it('is false once a modified file has hunks', () => {
    expect(isHunklessChange(emptyFileDiff([hunkOfLines(1)]))).toBe(false)
  })

  it('is false for a modified file with no hunks — nothing differs at all, not a hunk-less change', () => {
    expect(isHunklessChange(emptyFileDiff([]))).toBe(false)
  })
})

describe('isPatchHeaderLine', () => {
  it.each([
    'old mode 100644',
    'new mode 100755',
    'new file mode 100644',
    'deleted file mode 100644',
    'similarity index 82%',
    'rename from old.txt',
    'rename to new.txt',
    '--- a/f.txt',
    '+++ b/f.txt'
  ])('recognises %s', (line) => {
    expect(isPatchHeaderLine(line)).toBe(true)
  })

  it.each(['diff --git a/f.txt b/f.txt', 'index 111..222 100644', '@@ -1,2 +1,2 @@', ' context'])(
    'rejects %s',
    (line) => {
      expect(isPatchHeaderLine(line)).toBe(false)
    }
  )
})

describe('wholeFilePathsFor', () => {
  it('is just the path for an ordinary unstaged file', () => {
    const request: DiffRequest = {
      kind: 'unstaged',
      worktreePath: '/repo',
      path: 'f.txt'
    }
    expect(wholeFilePathsFor(request)).toEqual(['f.txt'])
  })

  it('is just the path for an untracked file', () => {
    const request: DiffRequest = { kind: 'untracked', worktreePath: '/repo', path: 'new.txt' }
    expect(wholeFilePathsFor(request)).toEqual(['new.txt'])
  })

  it('is both sides for a rename', () => {
    const request: DiffRequest = {
      kind: 'staged',
      worktreePath: '/repo',
      path: 'new.txt',
      origPath: 'old.txt'
    }
    expect(wholeFilePathsFor(request)).toEqual(['old.txt', 'new.txt'])
  })

  it('is just the path when origPath equals path', () => {
    const request: DiffRequest = {
      kind: 'staged',
      worktreePath: '/repo',
      path: 'f.txt',
      origPath: 'f.txt'
    }
    expect(wholeFilePathsFor(request)).toEqual(['f.txt'])
  })
})

describe('diffRequestIdentity', () => {
  it('is the same identity for the unstaged and staged sides of one file', () => {
    const unstaged: DiffRequest = { kind: 'unstaged', worktreePath: '/repo', path: 'f.txt' }
    const staged: DiffRequest = { kind: 'staged', worktreePath: '/repo', path: 'f.txt' }
    expect(diffRequestIdentity(unstaged)).toBe(diffRequestIdentity(staged))
  })

  it('differs for two different paths', () => {
    const a: DiffRequest = { kind: 'unstaged', worktreePath: '/repo', path: 'a.txt' }
    const b: DiffRequest = { kind: 'unstaged', worktreePath: '/repo', path: 'b.txt' }
    expect(diffRequestIdentity(a)).not.toBe(diffRequestIdentity(b))
  })

  it('differs for the same path in two different worktrees', () => {
    const a: DiffRequest = { kind: 'unstaged', worktreePath: '/repo-a', path: 'f.txt' }
    const b: DiffRequest = { kind: 'unstaged', worktreePath: '/repo-b', path: 'f.txt' }
    expect(diffRequestIdentity(a)).not.toBe(diffRequestIdentity(b))
  })

  it('differs between an untracked file and a tracked file of the same path', () => {
    const untracked: DiffRequest = { kind: 'untracked', worktreePath: '/repo', path: 'f.txt' }
    const tracked: DiffRequest = { kind: 'unstaged', worktreePath: '/repo', path: 'f.txt' }
    expect(diffRequestIdentity(untracked)).not.toBe(diffRequestIdentity(tracked))
  })

  it('differs between two commits, and between two paths within one commit', () => {
    const commitA: DiffRequest = { kind: 'commit', repoPath: '/repo', hash: 'aaa', path: 'f.txt' }
    const commitB: DiffRequest = { kind: 'commit', repoPath: '/repo', hash: 'bbb', path: 'f.txt' }
    const otherPath: DiffRequest = { kind: 'commit', repoPath: '/repo', hash: 'aaa', path: 'g.txt' }
    expect(diffRequestIdentity(commitA)).not.toBe(diffRequestIdentity(commitB))
    expect(diffRequestIdentity(commitA)).not.toBe(diffRequestIdentity(otherPath))
  })
})

describe('withDiffSide', () => {
  it('returns the request unchanged when no manual side is picked', () => {
    const request: DiffRequest = { kind: 'unstaged', worktreePath: '/repo', path: 'f.txt' }
    expect(withDiffSide(request, null)).toBe(request)
  })

  it('overrides an unstaged request with the manually picked staged side', () => {
    const request: DiffRequest = { kind: 'unstaged', worktreePath: '/repo', path: 'f.txt' }
    expect(withDiffSide(request, 'staged')).toEqual({
      kind: 'staged',
      worktreePath: '/repo',
      path: 'f.txt'
    })
  })

  it('overrides a staged request with the manually picked unstaged side', () => {
    const request: DiffRequest = { kind: 'staged', worktreePath: '/repo', path: 'f.txt' }
    expect(withDiffSide(request, 'unstaged')).toEqual({
      kind: 'unstaged',
      worktreePath: '/repo',
      path: 'f.txt'
    })
  })

  it('preserves origPath when overriding the side', () => {
    const request: DiffRequest = {
      kind: 'unstaged',
      worktreePath: '/repo',
      path: 'new.txt',
      origPath: 'old.txt'
    }
    expect(withDiffSide(request, 'staged')).toEqual({
      kind: 'staged',
      worktreePath: '/repo',
      path: 'new.txt',
      origPath: 'old.txt'
    })
  })

  it('ignores a manual side for an untracked file, which has none to pick', () => {
    const request: DiffRequest = { kind: 'untracked', worktreePath: '/repo', path: 'new.txt' }
    expect(withDiffSide(request, 'staged')).toBe(request)
  })

  it('ignores a manual side for a historical commit, which has none to pick', () => {
    const request: DiffRequest = { kind: 'commit', repoPath: '/repo', hash: 'aaa', path: 'f.txt' }
    expect(withDiffSide(request, 'unstaged')).toBe(request)
  })
})
