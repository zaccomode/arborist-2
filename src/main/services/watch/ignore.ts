import { sep } from 'path'

/**
 * Watched regardless of `.gitignore`, because these are common enough and
 * large enough that a repo without them listed is still worth protecting: a
 * `node_modules` that predates a `.gitignore` entry, or a build tool's own
 * scratch directory nobody bothered to ignore. Git's own ignored-directory
 * list (see `parseIgnoredDirectories`) is the real defence; this is the
 * floor under it.
 */
export const FLOOR_DIRECTORIES: readonly string[] = [
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  '__pycache__',
  '.DS_Store'
]

/**
 * Parses `git ls-files --others --directory --no-empty-directory -i
 * --exclude-standard -z` output into the top-level ignored directories it
 * names, each relative to the worktree root with its trailing slash
 * stripped. `-z` null-separates records, so this needs no line-ending
 * handling — the one thing `-z` exists to sidestep.
 */
export function parseIgnoredDirectories(stdout: string): string[] {
  return stdout
    .split('\0')
    .map((entry) => entry.replace(/\/+$/, ''))
    .filter((entry) => entry.length > 0)
}

/**
 * Builds chokidar's `ignored` matcher for the worktree tree watch: `.git`
 * anywhere, the hardcoded floor by directory name at any depth, and the
 * gitignored top-level directories `parseIgnoredDirectories` found, matched
 * by absolute path prefix rather than reimplementing `.gitignore` matching.
 *
 * Reads `ignoredDirectories()` on every call rather than closing over a
 * fixed array, so the caller can update the underlying array in place (a
 * `.gitignore` edit re-runs the git call) without rebuilding the watcher.
 */
export function buildIgnorePredicate(
  worktreePath: string,
  ignoredDirectories: () => readonly string[]
): (candidate: string) => boolean {
  const floor = new Set(FLOOR_DIRECTORIES)
  const prefix = worktreePath.endsWith(sep) ? worktreePath : worktreePath + sep

  return (candidate: string): boolean => {
    const relative = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : candidate
    const segments = relative.split(sep)

    if (segments[0] === '.git') return true
    if (segments.some((segment) => floor.has(segment))) return true

    // `git ls-files -z` always prints `/`, on every platform — converted to
    // the platform separator here so a nested ignored directory still
    // matches on Windows, where `relative` is `\`-joined.
    return ignoredDirectories().some((raw) => {
      const dir = sep === '/' ? raw : raw.split('/').join(sep)
      return relative === dir || relative.startsWith(dir + sep)
    })
  }
}
