import { join, sep } from 'path'
import { describe, it, expect } from 'vitest'
import { buildIgnorePredicate, parseIgnoredDirectories } from '../../src/main/services/watch/ignore'

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
