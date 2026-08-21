import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { AppError } from '../../../shared/errors'
import { sanitizeForFolder } from '../../../shared/branch-name'
import { mapWithConcurrency } from '../../../shared/concurrency'
import type { Worktree, WorktreeEntry, WorktreeStatus } from '../../../shared/domain'
import type { GitRunner } from './git-runner'
import { FETCH_TIMEOUT_MS } from './git-executor'
import {
  COMMIT_FORMAT,
  FIELD_SEPARATOR,
  parseCommit,
  parseStatus,
  parseUpstreamTrack,
  parseWorktreeList
} from './porcelain'

export const DEFAULT_REFRESH_CONCURRENCY = 6

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

  /**
   * Where a new worktree for `branch` goes by default: a sibling of the
   * repository, named after the branch, suffixed if something is already
   * there.
   */
  async suggestWorktreePath(repoPath: string, branch: string): Promise<string> {
    const parent = dirname(repoPath)
    const base = sanitizeForFolder(branch)

    for (let suffix = 1; suffix < 100; suffix++) {
      const candidate = join(parent, suffix === 1 ? base : `${base}-${suffix}`)
      if (!(await exists(candidate))) return candidate
    }
    return join(parent, base)
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
    options: { branch: string; path: string; baseRef?: string | null }
  ): Promise<string> {
    if (await exists(options.path)) {
      throw new AppError(`${options.path} already exists.`, 'path-already-exists')
    }

    const args = (await this.branchExists(repoPath, options.branch))
      ? ['worktree', 'add', options.path, options.branch]
      : [
          'worktree',
          'add',
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
