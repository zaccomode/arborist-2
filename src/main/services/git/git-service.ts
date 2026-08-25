import { promises as fs } from 'fs'
import { join } from 'path'
import { AppError } from '../../../shared/errors'
import { mapWithConcurrency } from '../../../shared/concurrency'
import type {
  BranchInfo,
  CommitLogEntry,
  RemoteBranch,
  WorkingTreeChanges,
  Worktree,
  WorktreeEntry,
  WorktreeStatus
} from '../../../shared/domain'
import {
  parseUnifiedDiff,
  syntheticNewFileDiff,
  truncateFileDiff,
  type DiffRequest,
  type FileDiff
} from '../../../shared/diff'
import { worktreeBasePath, type ResolvedLocation } from '../../../shared/worktree-location'
import { sortChangedFiles } from '../../../shared/working-tree'
import type { GitRunner } from './git-runner'
import { FETCH_TIMEOUT_MS } from './git-executor'
import {
  COMMIT_FORMAT,
  FIELD_SEPARATOR,
  LOG_FORMAT,
  LOG_RECORD_SEPARATOR,
  parseBranchList,
  parseCommit,
  parseCommitLog,
  parseRemoteBranchList,
  parseStatus,
  parseStatusV2,
  parseUpstreamTrack,
  parseWorktreeList
} from './porcelain'

export const DEFAULT_REFRESH_CONCURRENCY = 6

/**
 * Neutralises the user's own config either side of the flag list would
 * otherwise fight: `--no-textconv` so a textconv filter can't produce a diff
 * that doesn't apply back, `-U3` for a fixed context width, and explicit
 * prefixes so `parseUnifiedDiff` never has to guess whether a path is
 * prefixed. `-M` for rename detection: renames need both paths passed (see
 * `fileDiff`), or git reports the new path as a brand new file.
 */
const DIFF_FLAGS = [
  '--no-ext-diff',
  '--no-color',
  '--no-textconv',
  '-U3',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-M'
]

/**
 * Whether a fetch failure looks like a credentials problem, as opposed to an
 * unreachable host or a repository-side error. This is the one sanctioned
 * use of stderr matching in the codebase: it only selects which message the
 * user sees, never control flow, and `GIT_TERMINAL_PROMPT=0` (set app-wide in
 * `gitEnv`) makes git's own phrasing for "would have prompted" quite stable.
 */
function isAuthFailure(stderr: string): boolean {
  return /authentication failed|permission denied|could not read username|could not read password|terminal prompts disabled/i.test(
    stderr
  )
}

/** `origin/feature-x` -> `feature-x`: the name a local branch of the same branch would carry. */
function shortRemoteName(ref: string): string {
  return ref.slice(ref.indexOf('/') + 1)
}

/**
 * Turns a repository path into fully annotated worktree state: one
 * `worktree list` call, then per-worktree enrichment through a
 * concurrency-capped pool.
 *
 * Enrichment settles rather than races: a worktree git cannot answer for
 * comes back with a `statusError` and no status, and the refresh still
 * returns everything else.
 */
export class GitService {
  #git: GitRunner
  /** One in-flight fetch per repository, so concurrent callers share it. */
  #fetching = new Map<string, Promise<void>>()

  constructor(git: GitRunner) {
    this.#git = git
  }

  /**
   * `git fetch --all --prune`. Two rapid callers on the same repository
   * coalesce into one running fetch rather than racing git's lock files.
   */
  async fetchAll(repoPath: string): Promise<void> {
    const inFlight = this.#fetching.get(repoPath)
    if (inFlight) return inFlight

    const run = this.#runFetch(repoPath).finally(() => this.#fetching.delete(repoPath))
    this.#fetching.set(repoPath, run)
    return run
  }

  async #runFetch(repoPath: string): Promise<void> {
    const result = await this.#git.run(['fetch', '--all', '--prune'], {
      repoPath,
      timeoutMs: FETCH_TIMEOUT_MS
    })
    if (result.exitCode === 0) return

    if (isAuthFailure(result.stderr)) {
      throw new AppError(
        'Arborist uses your system git credentials; fetch from a terminal to check them.',
        'fetch-auth-failed'
      )
    }
    throw new AppError(result.stderr.trim() || 'git fetch failed', 'git-command-failed')
  }

  async listWorktrees(
    repoPath: string,
    concurrency: number = DEFAULT_REFRESH_CONCURRENCY
  ): Promise<Worktree[]> {
    const { stdout } = await this.#git.runOrThrow(['worktree', 'list', '--porcelain'], { repoPath })
    const entries = parseWorktreeList(stdout)

    const enriched = await mapWithConcurrency(entries, concurrency, (entry) => this.#enrich(entry))

    return entries.map((entry, index) => {
      const result = enriched[index]
      if (result.status === 'fulfilled') {
        return { ...entry, status: result.value, statusError: null }
      }
      return { ...entry, status: null, statusError: (result.reason as Error).message }
    })
  }

  async branchExists(repoPath: string, branch: string): Promise<boolean> {
    const { exitCode } = await this.#git.run(
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      { repoPath }
    )
    return exitCode === 0
  }

  /** Local branches, for the base-ref picker on create-worktree. */
  async listLocalBranches(repoPath: string): Promise<BranchInfo[]> {
    const { stdout } = await this.#git.runOrThrow(
      ['branch', '--list', '--format=%(refname:short)%(HEAD)'],
      { repoPath }
    )
    return parseBranchList(stdout)
  }

  /**
   * Where a new worktree for `branch` goes by default: named after the
   * branch under `worktreeBasePath`'s directory — a sibling of the
   * repository in `'beside'` mode, byte-identical to before this app could
   * do anything else — suffixed if something is already there.
   *
   * In `'central'` mode, a root that has gone missing (an unmounted drive, a
   * deleted folder) is checked here rather than left to `worktree add`:
   * without this, git would silently recreate the whole directory tree in
   * its place on the local disk instead of on the volume the user meant.
   */
  async suggestWorktreePath(
    repoPath: string,
    branch: string,
    location: ResolvedLocation,
    repoName: string
  ): Promise<string> {
    if (location.mode === 'central' && location.root && !(await exists(location.root))) {
      throw new AppError(
        `The central worktree directory ${location.root} no longer exists.`,
        'worktree-root-missing'
      )
    }

    const candidate = worktreeBasePath({
      location,
      repoPath,
      repoName,
      branch,
      platform: process.platform
    })
    if (!(await exists(candidate))) return candidate

    for (let suffix = 2; suffix < 100; suffix++) {
      const withSuffix = `${candidate}-${suffix}`
      if (!(await exists(withSuffix))) return withSuffix
    }
    return `${candidate}-99`
  }

  /**
   * Creates a worktree, checking out `branch` if it already exists and
   * creating it from `baseRef` (HEAD by default) if it does not.
   *
   * Both failure cases are pre-checked rather than read back out of git's
   * stderr. v1 classified errors by matching those strings, which breaks
   * across git versions and locales; a `show-ref` and a `stat` do not.
   */
  async createWorktree(
    repoPath: string,
    options: { branch: string; path: string; baseRef?: string | null; track?: boolean }
  ): Promise<string> {
    if (await exists(options.path)) {
      throw new AppError(`${options.path} already exists.`, 'path-already-exists')
    }

    const args = (await this.branchExists(repoPath, options.branch))
      ? ['worktree', 'add', options.path, options.branch]
      : [
          'worktree',
          'add',
          ...(options.track ? ['--track'] : []),
          '-b',
          options.branch,
          options.path,
          ...(options.baseRef ? [options.baseRef] : [])
        ]

    await this.#git.runOrThrow(args, { repoPath })
    return options.path
  }

  /**
   * Whether the worktree has uncommitted changes, asked fresh rather than
   * read off the last refresh: this decides whether deleting it needs the
   * second confirmation, and the answer has to be current.
   */
  async isDirty(worktreePath: string): Promise<boolean> {
    const { stdout } = await this.#git.runOrThrow(['status', '--porcelain'], {
      repoPath: worktreePath
    })
    return parseStatus(stdout).dirty
  }

  /** Per-file working-tree state for the Working Tree tab. */
  async workingTreeChanges(worktreePath: string): Promise<WorkingTreeChanges> {
    const { stdout } = await this.#git.runOrThrow(
      ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'],
      { repoPath: worktreePath }
    )
    const changes = parseStatusV2(stdout)
    // `status` groups tracked changes before untracked ones rather than
    // sorting by path, which the Working Tree tab shouldn't surface as row
    // order.
    return { ...changes, files: sortChangedFiles(changes.files) }
  }

  /**
   * `git add` on a deleted path stages the deletion (verified: ` D f.txt` →
   * `D  f.txt`), so this is the one call for every checked-row transition
   * into "will be in the next commit" — not just new content.
   */
  async stageFiles(worktreePath: string, paths: string[]): Promise<void> {
    await this.#git.runOrThrow(['add', '--', ...paths], { repoPath: worktreePath })
  }

  async unstageFiles(worktreePath: string, paths: string[]): Promise<void> {
    await this.#git.runOrThrow(['restore', '--staged', '--', ...paths], { repoPath: worktreePath })
  }

  /** Irreversible; the caller puts this behind a confirmation. */
  async discardFiles(
    worktreePath: string,
    paths: { tracked: string[]; untracked: string[] }
  ): Promise<void> {
    if (paths.tracked.length > 0) {
      await this.#git.runOrThrow(['restore', '--', ...paths.tracked], { repoPath: worktreePath })
    }
    if (paths.untracked.length > 0) {
      await this.#git.runOrThrow(['clean', '-f', '--', ...paths.untracked], {
        repoPath: worktreePath
      })
    }
  }

  /**
   * A multi-line message is a single argv entry and works: no shell, so
   * nothing needs escaping. Nothing staged exits 1 — the caller disables the
   * button from status rather than letting this fail.
   */
  async commit(worktreePath: string, message: string, amend: boolean): Promise<void> {
    await this.#git.runOrThrow(['commit', '-m', message, ...(amend ? ['--amend'] : [])], {
      repoPath: worktreePath
    })
  }

  /**
   * `--set-upstream` for a branch with nothing to compare against yet.
   * Reuses `isAuthFailure` for the message only, same as `fetchAll`.
   */
  async push(worktreePath: string, branch: string, setUpstream: boolean): Promise<void> {
    const args = setUpstream ? ['push', '--set-upstream', 'origin', branch] : ['push']
    const result = await this.#git.run(args, {
      repoPath: worktreePath,
      timeoutMs: FETCH_TIMEOUT_MS
    })
    if (result.exitCode === 0) return

    if (isAuthFailure(result.stderr)) {
      throw new AppError(
        'Arborist uses your system git credentials; push from a terminal to check them.',
        'push-auth-failed'
      )
    }
    throw new AppError(result.stderr.trim() || 'git push failed', 'git-command-failed')
  }

  /**
   * `git config --get user.email` exits 1 when unset — but git then guesses
   * an identity from gecos and hostname and commits successfully with it, so
   * this is a warning the caller shows, never a block on committing.
   */
  async hasIdentity(worktreePath: string): Promise<boolean> {
    const { exitCode } = await this.#git.run(['config', '--get', 'user.email'], {
      repoPath: worktreePath
    })
    return exitCode === 0
  }

  /**
   * The diff for one file, for the diff panel. Every case but `untracked`
   * runs through the same flag preamble, in buffer mode: main splits the raw
   * bytes on `0x0A` and decodes once, so `parseUnifiedDiff`'s line indices
   * and a future byte-accurate slice of the same buffer always agree (see
   * `diff-bytes.ts`). `untracked` makes no git call at all — `git diff
   * --no-index` against `/dev/null` exits 1 for "found a difference", which
   * fights `runOrThrow`, and `/dev/null` doesn't exist on Windows.
   */
  async fileDiff(request: DiffRequest): Promise<FileDiff> {
    if (request.kind === 'untracked') {
      return this.#untrackedDiff(request.worktreePath, request.path)
    }

    const pathspecs =
      request.origPath && request.origPath !== request.path
        ? [request.origPath, request.path]
        : [request.path]

    const args =
      request.kind === 'commit'
        ? [
            '-c',
            'diff.noprefix=false',
            '-c',
            'diff.mnemonicPrefix=false',
            'show',
            '--format=',
            '--diff-merges=first-parent',
            ...DIFF_FLAGS,
            request.hash,
            '--',
            ...pathspecs
          ]
        : [
            '-c',
            'diff.noprefix=false',
            '-c',
            'diff.mnemonicPrefix=false',
            'diff',
            ...(request.kind === 'staged' ? ['--cached'] : []),
            ...DIFF_FLAGS,
            '--',
            ...pathspecs
          ]

    const { stdoutBuffer } = await this.#git.runRaw(args, {
      repoPath: request.kind === 'commit' ? request.repoPath : request.worktreePath
    })
    return this.#parseDiffBuffer(stdoutBuffer ?? Buffer.alloc(0), request.path)
  }

  /**
   * Empty output is a real answer, not a failure: git prints nothing when
   * the file has no difference on the side asked for. That happens whenever
   * the status the panel was opened from has gone stale — the file was
   * reverted or committed in between — and on Windows for a mode-only
   * change, since there is no executable bit there to have changed. The
   * panel renders the no-hunks case as "No changes", so this returns that
   * rather than throwing an error over it.
   */
  #parseDiffBuffer(buffer: Buffer, path: string): FileDiff {
    const text = buffer.toString('utf8')
    const lossy = !Buffer.from(text, 'utf8').equals(buffer)
    const [file] = parseUnifiedDiff(text)
    if (!file) {
      return {
        oldPath: path,
        newPath: path,
        changeKind: 'modified',
        oldMode: null,
        newMode: null,
        similarity: null,
        binary: false,
        hunks: []
      }
    }
    const truncated = truncateFileDiff(file)
    return lossy ? { ...truncated, lossy: true } : truncated
  }

  /**
   * `content` is `null` for a binary file: the first 8000 bytes contain a
   * NUL, which text never does. `syntheticNewFileDiff` builds the same
   * shape a real `git diff` of a new file would.
   */
  async #untrackedDiff(worktreePath: string, path: string): Promise<FileDiff> {
    const buffer = await fs.readFile(join(worktreePath, path))
    const sniff = buffer.subarray(0, Math.min(buffer.length, 8000))
    const binary = sniff.includes(0)
    return truncateFileDiff(syntheticNewFileDiff(path, binary ? null : buffer.toString('utf8')))
  }

  /**
   * Removes a worktree and its directory. The branch is left alone, exactly
   * as v1 left it.
   */
  async removeWorktree(repoPath: string, worktreePath: string, force = false): Promise<void> {
    const args = ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath]
    await this.#git.runOrThrow(args, { repoPath })
  }

  /** Drops the entries for worktrees whose directories are gone. */
  async pruneWorktrees(repoPath: string): Promise<void> {
    await this.#git.runOrThrow(['worktree', 'prune'], { repoPath })
  }

  /**
   * Remote branches with no local worktree of their own, tip commit
   * included. The subtraction matches on short name — `origin/feature-x` is
   * hidden once a worktree exists on `feature-x` — which misses a local
   * branch deliberately tracking a differently-named remote branch. Rare
   * enough to accept.
   */
  async listRemoteBranches(
    repoPath: string,
    concurrency: number = DEFAULT_REFRESH_CONCURRENCY
  ): Promise<RemoteBranch[]> {
    const [remotes, worktrees] = await Promise.all([
      this.#git.runOrThrow(['branch', '-r', '--list', '--format=%(refname:short)'], { repoPath }),
      this.#git.runOrThrow(['worktree', 'list', '--porcelain'], { repoPath })
    ])

    const localBranches = new Set(
      parseWorktreeList(worktrees.stdout)
        .map((entry) => entry.branch)
        .filter((branch): branch is string => branch !== null)
    )
    const candidates = parseRemoteBranchList(remotes.stdout).filter(
      (ref) => !localBranches.has(shortRemoteName(ref))
    )

    const commits = await mapWithConcurrency(candidates, concurrency, (ref) =>
      this.#git.runOrThrow(['log', '-1', `--format=${COMMIT_FORMAT}`, ref], { repoPath })
    )

    return candidates.map((ref, index) => {
      const result = commits[index]
      return {
        name: ref,
        shortName: shortRemoteName(ref),
        lastCommit: result.status === 'fulfilled' ? parseCommit(result.value.stdout) : null
      }
    })
  }

  /**
   * Recent commits on `ref`, newest first, with `--shortstat` for the Recent
   * Commits panel. `repoPath` only has to be somewhere inside the
   * repository: it need not be the worktree `ref` belongs to, which is what
   * lets this run against a remote branch that has no local checkout at all.
   */
  async commitLog(
    repoPath: string,
    ref: string,
    limit: number,
    skip: number
  ): Promise<CommitLogEntry[]> {
    const { stdout } = await this.#git.runOrThrow(
      [
        'log',
        ref,
        '-n',
        String(limit),
        `--skip=${skip}`,
        '--date=iso-strict',
        '--shortstat',
        `--format=${LOG_RECORD_SEPARATOR}${LOG_FORMAT}`
      ],
      { repoPath }
    )
    return parseCommitLog(stdout)
  }

  async #enrich(entry: WorktreeEntry): Promise<WorktreeStatus> {
    // A prunable worktree's directory is gone and a bare repository has no
    // working tree, so there is nothing to ask about either of them.
    if (entry.prunable || entry.isBare) {
      return {
        dirty: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        upstream: null,
        ahead: 0,
        behind: 0,
        gone: false,
        lastCommit: null
      }
    }

    const repoPath = entry.path
    const [status, tracking, commit] = await Promise.all([
      this.#git.runOrThrow(['status', '--porcelain'], { repoPath }),
      entry.branch ? this.#tracking(repoPath, entry.branch) : Promise.resolve(null),
      this.#git.runOrThrow(['log', '-1', `--format=${COMMIT_FORMAT}`], { repoPath })
    ])

    return {
      ...parseStatus(status.stdout),
      upstream: tracking?.upstream ?? null,
      ahead: tracking?.track.ahead ?? 0,
      behind: tracking?.track.behind ?? 0,
      gone: tracking?.track.gone ?? false,
      lastCommit: parseCommit(commit.stdout)
    }
  }

  /**
   * Upstream name and divergence in one call. Asking git for its own
   * `%(upstream:track)` also settles whether the remote branch was deleted,
   * which `@{upstream}` cannot answer once the tracking ref is pruned.
   */
  async #tracking(
    repoPath: string,
    branch: string
  ): Promise<{ upstream: string | null; track: ReturnType<typeof parseUpstreamTrack> }> {
    const { stdout } = await this.#git.runOrThrow(
      ['for-each-ref', '--format=%(upstream:short)%00%(upstream:track)', `refs/heads/${branch}`],
      { repoPath }
    )
    const [upstream = '', track = ''] = stdout.split(/\r?\n/)[0]?.split(FIELD_SEPARATOR) ?? []
    return {
      upstream: upstream.trim() ? upstream.trim() : null,
      track: parseUpstreamTrack(track)
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}
