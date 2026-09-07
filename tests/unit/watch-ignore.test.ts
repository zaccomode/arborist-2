import { join, sep } from 'path'
import { describe, it, expect } from 'vitest'
import {
  buildIgnorePredicate,
  MAX_WATCHED_DIRECTORIES,
  parseIgnoredDirectories
} from '../../src/main/services/watch/ignore'

describe('parseIgnoredDirectories', () => {
  it('splits the null-separated output and strips trailing slashes', () => {
    expect(parseIgnoredDirectories('node_modules/\0dist/\0')).toEqual(['node_modules', 'dist'])
  })

  it('is empty for empty stdout', () => {
    expect(parseIgnoredDirectories('')).toEqual([])
  })

  it('leaves a directory with no trailing slash alone', () => {
    // `--directory` always appends one for a real directory match, but the
    // parser shouldn't assume it can't be handed a bare name.
    expect(parseIgnoredDirectories('coverage\0')).toEqual(['coverage'])
  })
})

describe('buildIgnorePredicate', () => {
  const root = join(sep, 'repo')
  const path = (...segments: string[]): string => join(root, ...segments)

  it('ignores anything under .git', () => {
    const ignored = buildIgnorePredicate(root, () => [])
    expect(ignored(path('.git'))).toBe(true)
    expect(ignored(path('.git', 'index'))).toBe(true)
    expect(ignored(path('.git', 'refs', 'heads', 'main'))).toBe(true)
  })

  it('ignores the hardcoded floor by directory name at any depth', () => {
    const ignored = buildIgnorePredicate(root, () => [])
    expect(ignored(path('node_modules'))).toBe(true)
    expect(ignored(path('node_modules', 'pkg', 'index.js'))).toBe(true)
    expect(ignored(path('packages', 'app', 'dist', 'bundle.js'))).toBe(true)
    expect(ignored(path('.DS_Store'))).toBe(true)
  })

  it('leaves an ordinary tracked file alone', () => {
    const ignored = buildIgnorePredicate(root, () => [])
    expect(ignored(path('src', 'index.ts'))).toBe(false)
    expect(ignored(root)).toBe(false)
  })

  it('ignores a directory git reports as gitignored, and its contents', () => {
    const ignored = buildIgnorePredicate(root, () => ['coverage'])
    expect(ignored(path('coverage'))).toBe(true)
    expect(ignored(path('coverage', 'lcov.info'))).toBe(true)
    // A same-prefix sibling must not be caught by a naive `startsWith`.
    expect(ignored(path('coverage-report', 'x.txt'))).toBe(false)
  })

  it('reads the ignored-directories list live, not a snapshot taken at build time', () => {
    let dirs: string[] = []
    const ignored = buildIgnorePredicate(root, () => dirs)
    expect(ignored(path('vendor', 'x.txt'))).toBe(false)

    dirs = ['vendor']
    expect(ignored(path('vendor', 'x.txt'))).toBe(true)
  })

  it('matches a nested ignored directory by its full relative path', () => {
    const ignored = buildIgnorePredicate(root, () => ['packages/legacy/build'])
    expect(ignored(path('packages', 'legacy', 'build', 'out.js'))).toBe(true)
    expect(ignored(path('packages', 'legacy', 'src', 'index.js'))).toBe(false)
  })

  /**
   * #83. Chokidar opens one `fs.watch`, and so holds one file descriptor,
   * per directory it watches. A monorepo has more directories than the
   * process has descriptors, and the first thing to notice is whatever the
   * user asked to spawn next — "Open in VS Code" failing with `spawn EBADF`.
   */
  describe('the directory budget', () => {
    const dir = { isDirectory: () => true }
    const file = { isDirectory: () => false }

    it('admits directories up to the budget and refuses the ones past it', () => {
      const ignored = buildIgnorePredicate(root, () => [], { max: 2 })

      expect(ignored(path('a'), dir)).toBe(false)
      expect(ignored(path('b'), dir)).toBe(false)
      expect(ignored(path('c'), dir)).toBe(true)
    })

    it('spends the budget once per directory, however often chokidar re-reads it', () => {
      const ignored = buildIgnorePredicate(root, () => [], { max: 2 })

      expect(ignored(path('a'), dir)).toBe(false)
      expect(ignored(path('a'), dir)).toBe(false)
      expect(ignored(path('b'), dir)).toBe(false)
    })

    // A file costs no watch of its own: chokidar hears about it through the
    // watch on the directory holding it.
    it('never counts a file, and never refuses one on the budget', () => {
      const ignored = buildIgnorePredicate(root, () => [], { max: 1 })

      expect(ignored(path('a'), dir)).toBe(false)
      expect(ignored(path('a', 'one.ts'), file)).toBe(false)
      expect(ignored(path('b', 'two.ts'), file)).toBe(false)
    })

    // Chokidar asks about a path both with and without stats; only the call
    // that says "this is a directory" is one this can act on.
    it('leaves a call with no stats alone rather than guessing', () => {
      const ignored = buildIgnorePredicate(root, () => [], { max: 0 })

      expect(ignored(path('a'))).toBe(false)
      expect(ignored(path('a'), dir)).toBe(true)
    })

    it('says so once, not once per directory it then refuses', () => {
      let calls = 0
      const ignored = buildIgnorePredicate(root, () => [], {
        max: 1,
        onExhausted: () => calls++
      })

      ignored(path('a'), dir)
      ignored(path('b'), dir)
      ignored(path('c'), dir)

      expect(calls).toBe(1)
    })

    it('leaves every repository below the cap watched exactly as before', () => {
      const ignored = buildIgnorePredicate(root, () => [], { max: MAX_WATCHED_DIRECTORIES })

      for (let i = 0; i < MAX_WATCHED_DIRECTORIES; i++) {
        expect(ignored(path('pkg', String(i)), dir)).toBe(false)
      }
    })

    it('still ignores .git and the floor without spending any budget on them', () => {
      const ignored = buildIgnorePredicate(root, () => [], { max: 1 })

      expect(ignored(path('.git'), dir)).toBe(true)
      expect(ignored(path('node_modules'), dir)).toBe(true)
      expect(ignored(path('src'), dir)).toBe(false)
      expect(ignored(path('lib'), dir)).toBe(true)
    })
  })

  /**
   * Chokidar hands the `ignored` predicate a forward-slash-normalized
   * candidate on every platform, no matter which separator the actual
   * watched path (and this file's own `worktreePath`) uses. On POSIX,
   * `path.sep` is already `/`, so a test built entirely from `path.join`
   * can't tell the difference between "matches candidates the way this
   * code expects" and "matches candidates the way chokidar actually
   * sends them" — both look the same. These cases hardcode a Windows-style
   * (`\`-separated) `worktreePath`, exactly as it would arrive on a real
   * Windows checkout, against forward-slash candidates, exactly as
   * chokidar's own `normalizePath` produces them regardless of host OS —
   * reproducing the real Windows call shape on any platform this suite
   * runs on, which is what caught this shipping broken despite every
   * `path.join`-built case above passing.
   */
  describe('candidates as chokidar actually delivers them, regardless of host platform', () => {
    const winRoot = 'C:\\Users\\dev\\repo'

    it('ignores anything under .git given a Windows-style worktreePath', () => {
      const ignored = buildIgnorePredicate(winRoot, () => [])
      expect(ignored('C:/Users/dev/repo/.git/index')).toBe(true)
    })

    it('ignores the hardcoded floor at any depth given a Windows-style worktreePath', () => {
      const ignored = buildIgnorePredicate(winRoot, () => [])
      expect(ignored('C:/Users/dev/repo/node_modules/pkg/index.js')).toBe(true)
    })

    it('ignores a git-reported directory given a Windows-style worktreePath', () => {
      const ignored = buildIgnorePredicate(winRoot, () => ['ignored-dir'])
      expect(ignored('C:/Users/dev/repo/ignored-dir/placeholder.txt')).toBe(true)
    })

    it('still leaves an ordinary tracked file alone', () => {
      const ignored = buildIgnorePredicate(winRoot, () => [])
      expect(ignored('C:/Users/dev/repo/src/index.ts')).toBe(false)
    })
  })
})
