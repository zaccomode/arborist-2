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
 * Chokidar normalizes a path to forward slashes before handing it to a
 * custom `ignored` predicate (see chokidar's `matchPatterns` ->
 * `normalizePath`), on every platform, regardless of what separator the
 * path used going in. A path this app hands chokidar to *watch* (or gets
 * back from `git`, which also always prints `/`) keeps its own format
 * until then. Working in this same forward-slash space throughout —
 * rather than the platform's `path.sep` — is what makes matching agree
 * with what chokidar is actually going to call this function with.
 */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
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
 *
 * Matches in forward-slash space throughout (see `toPosix`): matching
 * against `path.sep` here used to work by accident on POSIX, where `sep` is
 * already `/`, and silently matched nothing at all on Windows — chokidar
 * hands this function a `/`-normalized candidate no matter the platform, so
 * splitting that candidate on `\` (Windows' `path.sep`) returned the whole
 * path as a single segment, and neither the `.git` check, the floor check,
 * nor the gitignored-directory check could ever match. This is why it
 * shipped broken for Windows despite every case in `watch-ignore.test.ts`
 * passing: that suite built its candidate paths with `path.join`, which
 * produces the *native* separator the code was written against, not the
 * forward-slash form chokidar actually calls this with.
 */
export function buildIgnorePredicate(
  worktreePath: string,
  ignoredDirectories: () => readonly string[]
): (candidate: string) => boolean {
  const floor = new Set(FLOOR_DIRECTORIES)
  const root = toPosix(worktreePath)
  const prefix = root.endsWith('/') ? root : root + '/'

  return (candidate: string): boolean => {
    const posixCandidate = toPosix(candidate)
    const relative = posixCandidate.startsWith(prefix)
      ? posixCandidate.slice(prefix.length)
      : posixCandidate
    const segments = relative.split('/')

    if (segments[0] === '.git') return true
    if (segments.some((segment) => floor.has(segment))) return true

    // `git ls-files -z` always prints `/`, on every platform, which is
    // already this function's own matching space — no conversion needed.
    return ignoredDirectories().some((dir) => relative === dir || relative.startsWith(dir + '/'))
  }
}
