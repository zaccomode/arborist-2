import { promises as fs } from 'fs'
import { basename, dirname } from 'path'
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

/**
 * Windows-only: applied to the metadata watchers (`refs/heads`, and the
 * directories holding `index`/`HEAD`/`packed-refs`), never the tree watcher.
 *
 * `git add`/`commit` replace these files by writing a lockfile and renaming
 * it over the target rather than editing in place. On Windows, a rename onto
 * an existing name is a documented gap in `fs.watch`'s `ReadDirectoryChangesW`
 * backend: no event is emitted for the *original* path at all (nodejs/node-v0.x-archive#8372),
 * as opposed to macOS/Linux, which at least emit something for it (chokidar's
 * own `isMacos || isLinux || isFreeBSD` recovery path — see the class doc
 * comment — exists to catch exactly that something). Watching the containing
 * directory rather than the literal file, the fix this file shipped with
 * first, doesn't route around this: chokidar's own directory-watch machinery
 * (`_handleDir`/`_handleRead` in chokidar's `handler.js`) only re-arms a
 * *file* watch for a name it hasn't seen in that directory before — a rename
 * onto an existing, already-tracked name is invisible to it too, for the same
 * underlying reason. `usePolling: true` switches these few, small watches
 * from `fs.watch` to `fs.watchFile`, which re-`stat`s the literal path on an
 * interval instead of holding a watch bound to a specific handle — so it
 * doesn't matter what got swapped in underneath. This is a documented,
 * widely-used community workaround for exactly this Windows gap (see e.g.
 * chokidar#611, chokidar#237), not a guess; verifying it actually clears CI
 * on `windows-latest` is the one part of this that can't be confirmed
 * locally. Scoped to just these few files/directories — never the tree
 * watcher, which is the unbounded-cost recursive watch this class exists to
 * avoid turning the metadata watch into.
 *
 * A plain function of `platform` rather than a constant read from
 * `process.platform` directly, so `tests/unit/watch-meta-options.test.ts`
 * can exercise the win32 branch on whatever platform this suite itself
 * happens to run on — the one part of this fix that can't be exercised
 * end-to-end without a Windows runner.
 */
export function metaWatchOptions(platform: NodeJS.Platform): { usePolling?: true } {
  return platform === 'win32' ? { usePolling: true } : {}
}

const META_WATCH_OPTIONS = metaWatchOptions(process.platform)

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
 * - Git's own metadata, as four paths resolved per worktree (see
 *   `git-paths.ts`) rather than `.git` recursively, which fires hundreds of
 *   times during a fetch or a gc. Resolving them matters because a linked
 *   worktree's index lives under `<repo>/.git/worktrees/<name>/index`, not
 *   `<repo>/.git/index` — watching the latter works for the main worktree
 *   and never fires for any other, which is exactly the case Arborist
 *   exists to serve. `index`, `HEAD` and `packed-refs` are watched via
 *   their *containing directories*, not as the literal files themselves:
 *   `git add`/`commit` replace each of these by writing a lockfile and
 *   renaming it over the target rather than editing it in place (verified —
 *   the inode changes on every `git add`), and a watch bound to the literal
 *   file path is a watch on that specific inode/handle. Whether a watch
 *   notices once the rename swaps in a new inode at the same path turns out
 *   to depend on the platform in ways that are hard to fully pin down from
 *   source alone (chokidar has its own recovery path for exactly this,
 *   gated to `isMacos || isLinux || isFreeBSD` — Windows gets none at all,
 *   and the mac branch was still observed to miss the very next event on a
 *   real macOS CI runner). The containing directory is never itself
 *   replaced, so a watch on it is never stale; `depth: 0` keeps it from
 *   becoming a `.git`-recursive watch, since the common git dir holds
 *   `objects/`, `refs/`, `logs/` etc alongside `packed-refs` and depth 0
 *   watches only its direct children. `refs/heads` stays a direct,
 *   recursively-watched directory as before — nested branch names need the
 *   recursion, and unlike a single file, the directory holding them is
 *   never wholesale-replaced, so it was never exposed to this problem.
 *   Watching the containing directory still wasn't enough on Windows —
 *   chokidar's own directory-watch machinery only re-arms a *file* watch for
 *   a name it hasn't seen in that directory before, so a rename onto an
 *   already-tracked name (exactly what's happening here) is just as
 *   invisible to it as watching the file directly was. See
 *   `META_WATCH_OPTIONS` below for the platform-specific fix on top of this.
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
  #metaWatchers: FSWatcher[] = []
  #refsWatcher: FSWatcher | null = null
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

    // `refs/heads`: a direct, recursively-watched directory, as before —
    // nested branch names (`refs/heads/feature/x`) need the recursion, and
    // unlike the single files below, the directory holding them is never
    // itself wholesale-replaced, so it was never exposed to the rename-swap
    // problem the class doc comment describes. It is, in principle, absent
    // for an instant on a repository with zero commits and zero branches —
    // unverified in practice (`git init` creates it empty), but treated the
    // same as the metadata directories below regardless: skipped rather
    // than blocking `watch()` on a path that may never appear.
    const refsHeadsExists = await pathExists(gitPaths.refsHeads)
    if (!isCurrent()) return
    if (refsHeadsExists) {
      const refsWatcher = watchPaths(gitPaths.refsHeads, {
        ignoreInitial: true,
        ...META_WATCH_OPTIONS
      })
      refsWatcher.on('all', (_event, changedPath) => {
        if (!isCurrent()) return
        const reason = reasonForGitPath(changedPath, gitPaths)
        if (reason) this.#debouncer?.trigger(reason)
      })
      refsWatcher.on('error', (error) => {
        console.error(`[watcher] refs watch failed for ${target}:`, error)
        if (isCurrent()) void this.#teardown()
      })
      this.#refsWatcher = refsWatcher
      await onceReady(refsWatcher)
      if (!isCurrent()) return
    }

    // `index`, `HEAD` and `packed-refs`: watched via their *containing*
    // directories (see the class doc comment for why), deduped — the main
    // worktree's index, HEAD and packed-refs all live directly under one
    // directory, `.git` itself, so this is one shallow watch there rather
    // than three. `depth: 0` is what keeps a watch on the common git dir
    // from becoming the `.git`-recursive watch this design exists to avoid.
    // Watching the directory rather than `packed-refs` itself also quietly
    // retires the file's own former existence race (it's routinely absent —
    // git only writes it on a `gc`/`pack-refs`): the directory is present
    // regardless, and its own later creation is just an ordinary `add`
    // event inside an already-watched directory.
    const metaDirs = [
      ...new Set([dirname(gitPaths.index), dirname(gitPaths.head), dirname(gitPaths.packedRefs)])
    ]
    const existingMetaDirs = (await mapWithExistence(metaDirs))
      .filter((entry) => entry.exists)
      .map((entry) => entry.path)
    if (!isCurrent()) return

    // One `FSWatcher` per directory, deliberately, rather than one call
    // covering the whole array: chokidar has already shown once in this
    // file (see `resolveGitWatchPaths`'s history) that handing it several
    // paths in a single `watch()` call is not reliable — the earlier bug
    // was an existing/not-yet-existing mix silently dropping the existing
    // ones, and a linked worktree's two metadata directories (its own
    // `worktrees/<name>/` plus the shared common `.git` for `packed-refs`)
    // reproduce the same failure shape even though both exist here: only
    // the array's last entry reliably ends up watched on `windows-latest`
    // under `usePolling`. A separate small watcher per directory has no
    // such multi-path array for chokidar to mishandle.
    for (const dir of existingMetaDirs) {
      const metaWatcher = watchPaths(dir, {
        ignoreInitial: true,
        depth: 0,
        ...META_WATCH_OPTIONS
      })
      metaWatcher.on('all', (_event, changedPath) => {
        if (!isCurrent()) return
        const reason = reasonForGitPath(changedPath, gitPaths)
        if (reason) this.#debouncer?.trigger(reason)
      })
      metaWatcher.on('error', (error) => {
        console.error(`[watcher] metadata watch failed for ${target}:`, error)
        if (isCurrent()) void this.#teardown()
      })
      this.#metaWatchers.push(metaWatcher)
      await onceReady(metaWatcher)
      if (!isCurrent()) return
    }

    // Windows only, layered on top of the directory watches above: `index`
    // and `HEAD` watched a second time, as the literal file paths, with
    // polling. Two attempts already tried to fix the linked-worktree case
    // on `windows-latest` by adjusting the *directory* watch (usePolling on
    // the directory; one watcher per directory instead of a shared array)
    // and neither cleared it, which points at something more specific than
    // either of those: chokidar's directory-level polling appears to work
    // by diffing which *names* are present in a periodic `readdir`, the
    // same shape of check native directory events already have trouble
    // with — a rename onto an existing name changes no name in that list,
    // so nothing about the entry looking different is what a directory poll
    // is built to notice. `fs.watchFile` on the exact file path, which is
    // what `usePolling` actually maps to at the file level, re-stats that
    // one path every interval and compares the whole `Stats` object
    // regardless of the inode behind it — the change chokidar's own cited
    // community fixes (chokidar#611, #237) are about, and unlike those
    // issues, this file's very first fix in this PR already established
    // that a directory-level watch is what's needed elsewhere (a `depth: 0`
    // watch is what lets `packed-refs`, which is often simply absent, be
    // noticed once it's created — a *file* watch on a path with nothing
    // there yet is a different, better-trodden case for `fs.watchFile`,
    // which already tolerates ENOENT and starts reporting once the path
    // appears, so it isn't dropped from this list on existence either).
    // `packed-refs` itself is deliberately left off this second pass: it
    // isn't part of the rename-swap pattern this targets (nothing renames
    // onto it on every commit the way `index`/`HEAD` do), and the directory
    // watch above already covers its (rarer) appearance.
    if (META_WATCH_OPTIONS.usePolling) {
      for (const file of [gitPaths.index, gitPaths.head]) {
        const fileWatcher = watchPaths(file, {
          ignoreInitial: true,
          usePolling: true
        })
        fileWatcher.on('all', (_event, changedPath) => {
          if (!isCurrent()) return
          const reason = reasonForGitPath(changedPath, gitPaths)
          if (reason) this.#debouncer?.trigger(reason)
        })
        fileWatcher.on('error', (error) => {
          console.error(`[watcher] metadata file watch failed for ${target}:`, error)
          if (isCurrent()) void this.#teardown()
        })
        this.#metaWatchers.push(fileWatcher)
        await onceReady(fileWatcher)
        if (!isCurrent()) return
      }
    }
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
    const meta = this.#metaWatchers
    const refs = this.#refsWatcher
    this.#treeWatcher = null
    this.#metaWatchers = []
    this.#refsWatcher = null
    this.#debouncer?.cancel()
    this.#debouncer = null
    await Promise.all([tree?.close(), ...meta.map((watcher) => watcher.close()), refs?.close()])
  }
}
