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
 * How many directories the tree watcher will take on before it stops
 * descending (#83).
 *
 * Chokidar opens one `fs.watch` per directory, and every one of those holds
 * a file descriptor for as long as the watch lives. A monorepo runs to tens
 * of thousands of directories even with `.gitignore` honoured, which is
 * enough to spend the whole process's descriptor allowance — and the next
 * thing that needs one is whatever the user just asked for: `spawn` answers
 * `EBADF` and "Open in VS Code" fails with an error about a file descriptor,
 * which is what #83 reported. The built-ins that never spawn (Finder, via
 * Electron's own `shell`) kept working, which is what pointed at this.
 *
 * A cap rather than an exact accounting of the machine's limit: the limit
 * differs by platform and by how the app was launched, and this only has to
 * stay well under the smallest one worth supporting while leaving room for
 * the git processes a refresh runs, the app's own sockets, and whatever is
 * being launched. A repository smaller than this — which is nearly all of
 * them — is watched exactly as before.
 *
 * Beyond the cap, changes made outside Arborist stop arriving on their own
 * for the directories that missed out. The manual refresh and the
 * regain-focus refresh (#61) still re-read everything, so the fallback is
 * the one that already existed for a watcher that misses an event.
 */
export const MAX_WATCHED_DIRECTORIES = 4096

/**
 * A ceiling on how many directories the predicate will admit, plus a
 * one-shot callback for when it is reached. Omit it to admit every
 * directory, which is what the tests and the metadata watches want.
 */
export interface DirectoryBudget {
  max: number
  onExhausted?: () => void
}

/** Just the part of `fs.Stats` this needs, so a test can hand it a stub. */
interface StatsLike {
  isDirectory: () => boolean
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
 *
 * With a `budget`, it is also what stops a huge repository from spending the
 * process's file descriptors — see `MAX_WATCHED_DIRECTORIES`. Chokidar asks
 * about a directory, with its `stats`, before it opens a watch on it, so
 * refusing one here is what keeps the watch from being opened at all.
 */
export function buildIgnorePredicate(
  worktreePath: string,
  ignoredDirectories: () => readonly string[],
  budget?: DirectoryBudget
): (candidate: string, stats?: StatsLike) => boolean {
  const floor = new Set(FLOOR_DIRECTORIES)
  const root = toPosix(worktreePath)
  const prefix = root.endsWith('/') ? root : root + '/'
  // The directories already admitted, so chokidar re-reading one it is
  // watching never spends the budget twice on it.
  const admitted = new Set<string>()
  let exhausted = false

  return (candidate: string, stats?: StatsLike): boolean => {
    const posixCandidate = toPosix(candidate)
    const relative = posixCandidate.startsWith(prefix)
      ? posixCandidate.slice(prefix.length)
      : posixCandidate
    const segments = relative.split('/')

    if (segments[0] === '.git') return true
    if (segments.some((segment) => floor.has(segment))) return true

    // `git ls-files -z` always prints `/`, on every platform, which is
    // already this function's own matching space — no conversion needed.
    if (ignoredDirectories().some((dir) => relative === dir || relative.startsWith(dir + '/'))) {
      return true
    }

    // Files cost no watch of their own — chokidar learns about them from the
    // watch on the directory holding them — so only directories are counted,
    // and a call with no `stats` (chokidar checks a path both ways) is left
    // alone rather than guessed at.
    if (!budget || !stats?.isDirectory()) return false
    if (admitted.has(posixCandidate)) return false
    if (admitted.size >= budget.max) {
      if (!exhausted) {
        exhausted = true
        budget.onExhausted?.()
      }
      return true
    }
    admitted.add(posixCandidate)
    return false
  }
}
