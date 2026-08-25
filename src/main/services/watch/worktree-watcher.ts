import { promises as fs } from 'fs'
import { basename } from 'path'
import { watch as watchPaths, type FSWatcher } from 'chokidar'
import type { WorktreeChangeReason } from '../../../shared/ipc-contract'
import { createDebouncer, type Debouncer } from '../../../shared/debounce'
import type { GitRunner } from '../git/git-runner'
import { buildIgnorePredicate, parseIgnoredDirectories } from './ignore'
import { reasonForGitPath, resolveGitWatchPaths } from './git-paths'

const TRAILING_DEBOUNCE_MS = 250
const MAX_DEBOUNCE_WAIT_MS = 1000

/** The default suppression window `suppress()` opens for a mutating write. */
const DEFAULT_SUPPRESS_MS = 400

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function mapWithExistence(
  paths: readonly string[]
): Promise<{ path: string; exists: boolean }[]> {
  return Promise.all(paths.map(async (path) => ({ path, exists: await pathExists(path) })))
}

/**
 * Chokidar's `watch()` returns an `FSWatcher` synchronously, but the actual
 * `fs.watch` registration it does under the hood — walking the tree with
 * `readdirp` and opening a watch per directory — happens afterwards, off the
 * synchronous call. A write landing in that gap is simply never seen: there
 * is no buffering of filesystem events from before a watch existed. Waiting
 * for `'ready'` here is what makes `watch()` actually mean "watching" rather
 * than "asked to start watching soon".
 */
function onceReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve) => {
    watcher.once('ready', () => resolve())
    // A watch that fails before ever becoming ready (a path that vanished
    // between the existence check and here) still has to let `watch()`
    // return rather than hang — the already-registered `error` handler is
    // what tears it down.
    watcher.once('error', () => resolve())
  })
}

/**
 * Watches the *selected* worktree only — never every worktree, never every
 * project — for changes made outside Arborist: an editor, a build, a commit
 * from the terminal. One instance, owned by the composition root
 * (`app.whenReady()` in `main/index.ts`), with `watch()` replacing whatever
 * it was watching before.
 *
 * Two independent chokidar watchers per selection:
 *
 * - The worktree tree itself, recursively, ignoring `.git`, a hardcoded
 *   floor of build/dependency directories, and whatever `git` itself says is
 *   ignored at the top level (see `ignore.ts`) — the reason a large repo
 *   with a real `.gitignore` doesn't melt this.
 * - Git's own metadata, as four explicit file paths resolved per worktree
 *   (see `git-paths.ts`) rather than `.git` recursively, which fires
 *   hundreds of times during a fetch or a gc. Resolving them matters because
 *   a linked worktree's index lives under
 *   `<repo>/.git/worktrees/<name>/index`, not `<repo>/.git/index` — watching
 *   the latter works for the main worktree and never fires for any other,
 *   which is exactly the case Arborist exists to serve.
 *
 * Every raw event funnels through one `Debouncer` keyed by
 * `WorktreeChangeReason`, so a burst on one reason (a long `npm install`
 * touching hundreds of files under `'worktree'`) can't starve an unrelated
 * one, and each reason still gets a floor of one push a second even under
 * continuous activity.
 *
 * `suppress()` is belt-and-braces against the feedback loop every Arborist
 * write would otherwise start (write → watcher fires → main refetches
 * status → status write refires the watcher → …): the primary defence is
 * `GIT_OPTIONAL_LOCKS=0` in `gitEnv` (see that file's comment), which stops
 * `git status` from writing the refreshed index back at all, so there is
 * nothing there for the watcher to catch a second time. `suppress()` just
 * covers the moment of the mutation itself.
 */
export class WorktreeWatcher {
  #git: GitRunner
  #emit: (worktreePath: string, reason: WorktreeChangeReason) => void
  #treeWatcher: FSWatcher | null = null
  #metaWatcher: FSWatcher | null = null
  #debouncer: Debouncer<WorktreeChangeReason> | null = null
  #ignoredDirectories: string[] = []
  #suppressedUntil = new Map<string, number>()
  /**
   * Bumped on every `watch()` call and captured by that call's closures, so
   * a chokidar event or a still-in-flight `resolveGitWatchPaths` from a
   * superseded selection can tell it's stale and drop itself instead of
   * emitting for the wrong worktree.
   */
  #generation = 0

  constructor(git: GitRunner, emit: (worktreePath: string, reason: WorktreeChangeReason) => void) {
    this.#git = git
    this.#emit = emit
  }

  /**
   * Opens a window during which changes to `worktreePath` are swallowed
   * rather than emitted. Called by every mutating `GitService` operation
   * before it runs; see the class doc comment for why this is a backstop
   * rather than the real fix.
   */
  suppress(worktreePath: string, ms = DEFAULT_SUPPRESS_MS): void {
    this.#suppressedUntil.set(worktreePath, Date.now() + ms)
  }

  #isSuppressed(worktreePath: string): boolean {
    const until = this.#suppressedUntil.get(worktreePath)
    return until !== undefined && Date.now() < until
  }

  /**
   * Replaces whatever this watcher was watching. `null` stops it — the
   * shape a deselected worktree and app shutdown both want. Never throws: a
   * worktree whose directory has gone (prunable) or whose git metadata
   * cannot be resolved (mid-removal) becomes a no-op watch rather than a
   * rejected promise, and a chokidar `error` after that stops this
   * selection's watchers and logs, rather than reaching main as an unhandled
   * rejection or event.
   */
  async watch(worktreePath: string | null): Promise<void> {
    const generation = ++this.#generation
    await this.#teardown()

    if (!worktreePath) return
    if (process.env['ARBORIST_DISABLE_WATCHER'] === '1') return
    if (!(await pathExists(worktreePath))) return
    if (generation !== this.#generation) return

    const target = worktreePath
    const isCurrent = (): boolean => generation === this.#generation

    this.#debouncer = createDebouncer<WorktreeChangeReason>(
      (reason) => {
        if (!isCurrent()) return
        if (this.#isSuppressed(target)) return
        this.#emit(target, reason)
      },
      TRAILING_DEBOUNCE_MS,
      MAX_DEBOUNCE_WAIT_MS
    )

    this.#ignoredDirectories = await this.#listIgnoredDirectories(target)
    if (!isCurrent()) return

    const ignored = buildIgnorePredicate(target, () => this.#ignoredDirectories)
    const treeWatcher = watchPaths(target, {
      ignoreInitial: true,
      ignored,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    treeWatcher.on('all', (_event, changedPath) => {
      if (!isCurrent()) return
      // A tracked-vs-ignored decision made at watch start can go stale the
      // moment someone edits the file that drives it.
      if (basename(changedPath) === '.gitignore') void this.#refreshIgnoredDirectories(target)
      this.#debouncer?.trigger('worktree')
    })
    treeWatcher.on('error', (error) => {
      console.error(`[watcher] tree watch failed for ${target}:`, error)
      if (isCurrent()) void this.#teardown()
    })
    this.#treeWatcher = treeWatcher
    await onceReady(treeWatcher)
    if (!isCurrent()) return

    const gitPaths = await resolveGitWatchPaths(this.#git, target)
    if (!isCurrent()) return
    if (!gitPaths) return

    // `packed-refs` in particular is routinely absent (git only writes it on
    // a `gc`/`pack-refs`), and handing chokidar one `watch()` call mixing an
    // existing path with a not-yet-existing one is not just slower to settle
    // — verified: it silently drops watches on the *other*, already-existing
    // paths in the same call too, so `refs/heads` (say) never fires at all.
    // Watching the paths that exist right now up front, in one call so they
    // still share a `'ready'` this method can wait on, and adding whichever
    // don't exist yet afterwards with a plain `.add()`, keeps that failure
    // mode from ever mixing the two.
    const allPaths = [gitPaths.index, gitPaths.head, gitPaths.refsHeads, gitPaths.packedRefs]
    const existing = await mapWithExistence(allPaths)

    const metaWatcher = watchPaths(
      existing.filter((entry) => entry.exists).map((entry) => entry.path),
      { ignoreInitial: true }
    )
    metaWatcher.on('all', (_event, changedPath) => {
      if (!isCurrent()) return
      const reason = reasonForGitPath(changedPath, gitPaths)
      if (reason) this.#debouncer?.trigger(reason)
    })
    metaWatcher.on('error', (error) => {
      console.error(`[watcher] metadata watch failed for ${target}:`, error)
      if (isCurrent()) void this.#teardown()
    })
    this.#metaWatcher = metaWatcher

    const missing = existing.filter((entry) => !entry.exists).map((entry) => entry.path)
    // At least one path (the worktree always has an index and a HEAD by the
    // time it's selectable) exists in the ordinary case, so `'ready'` fires.
    // On the all-missing edge case it never would (verified), so this is
    // skipped rather than hung on forever; the paths above go watched
    // regardless via the plain `.add()` calls below, just without this
    // method waiting for that to finish.
    if (existing.some((entry) => entry.exists)) await onceReady(metaWatcher)
    for (const path of missing) metaWatcher.add(path)
  }

  /** Stops watching for good — `window-all-closed` and `before-quit`. */
  async stop(): Promise<void> {
    this.#generation++
    await this.#teardown()
  }

  async #refreshIgnoredDirectories(worktreePath: string): Promise<void> {
    this.#ignoredDirectories = await this.#listIgnoredDirectories(worktreePath)
  }

  /**
   * One `git ls-files` call, git's own matcher, exact — the reason this
   * doesn't reimplement `.gitignore` matching. A failure (a `.git` in a
   * transient state) just means nothing extra is ignored this round rather
   * than blocking the watch.
   */
  async #listIgnoredDirectories(worktreePath: string): Promise<string[]> {
    const result = await this.#git.run(
      [
        'ls-files',
        '--others',
        '--directory',
        '--no-empty-directory',
        '-i',
        '--exclude-standard',
        '-z'
      ],
      { repoPath: worktreePath }
    )
    if (result.exitCode !== 0) return []
    return parseIgnoredDirectories(result.stdout)
  }

  async #teardown(): Promise<void> {
    const tree = this.#treeWatcher
    const meta = this.#metaWatcher
    this.#treeWatcher = null
    this.#metaWatcher = null
    this.#debouncer?.cancel()
    this.#debouncer = null
    await Promise.all([tree?.close(), meta?.close()])
  }
}
