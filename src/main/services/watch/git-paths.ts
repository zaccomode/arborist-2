import { isAbsolute, join } from 'path'
import type { GitRunner } from '../git/git-runner'
import type { WorktreeChangeReason } from '../../../shared/ipc-contract'
import { normaliseForCompare } from '../../../shared/paths'

/**
 * The git metadata paths this worktree's watcher watches as explicit files —
 * never `.git` recursively, which fires hundreds of times during a fetch or
 * a gc. Resolved per worktree rather than assumed, because a linked
 * worktree's `.git` is a *file* pointing elsewhere and its index is not
 * under the worktree at all: watching `<repo>/.git/index` only ever fires
 * for the main worktree.
 */
export interface GitWatchPaths {
  index: string
  head: string
  refsHeads: string
  packedRefs: string
}

/**
 * `git rev-parse --git-path <x>` prints a path relative to the invoking
 * directory when it has to guess one, but in every case this app cares about
 * (a `.git` file whose `gitdir:` line git itself always writes absolute) it
 * comes back already absolute. `join` under a relative result is
 * defence-in-depth, not the expected path.
 */
function resolve(worktreePath: string, raw: string): string {
  const trimmed = raw.trim()
  return isAbsolute(trimmed) ? trimmed : join(worktreePath, trimmed)
}

/**
 * Resolves the four paths to watch for `worktreePath`, or `null` if any of
 * the three `git` calls this needs fails — a worktree mid-removal, say. The
 * caller treats that the same as "nothing to watch" rather than throwing.
 */
export async function resolveGitWatchPaths(
  git: GitRunner,
  worktreePath: string
): Promise<GitWatchPaths | null> {
  const [indexResult, headResult, commonDirResult] = await Promise.all([
    git.run(['rev-parse', '--git-path', 'index'], { repoPath: worktreePath }),
    git.run(['rev-parse', '--git-path', 'HEAD'], { repoPath: worktreePath }),
    git.run(['rev-parse', '--git-common-dir'], { repoPath: worktreePath })
  ])
  if (indexResult.exitCode !== 0 || headResult.exitCode !== 0 || commonDirResult.exitCode !== 0) {
    return null
  }

  const commonDir = resolve(worktreePath, commonDirResult.stdout)
  return {
    index: resolve(worktreePath, indexResult.stdout),
    head: resolve(worktreePath, headResult.stdout),
    refsHeads: join(commonDir, 'refs', 'heads'),
    packedRefs: join(commonDir, 'packed-refs')
  }
}

/**
 * Which reason a changed path under `GitWatchPaths` maps to: `refsHeads` is
 * a directory, matched by prefix, since branches nest (`refs/heads/feature/x`);
 * the rest are exact files. Returns `null` for a path that belongs to none of
 * them, which should not happen given how the watcher is constructed but is
 * cheaper to check than to assume away.
 *
 * Compared through `normaliseForCompare` rather than by raw string equality —
 * four straight attempts at fixing the linked-worktree case on
 * `windows-latest` by changing *how* the metadata paths were watched (native
 * events, polling on the directory, one watcher per directory, polling on the
 * literal file) all failed identically, which is what a watch that fires but
 * a comparison that silently never matches looks like, not what a watch that
 * never fires looks like. `git rev-parse --git-path` for a *linked* worktree
 * has to resolve the `.git` file's `gitdir:` indirection first, which is
 * exactly the step that doesn't exist for the main worktree — the one case
 * that was passing the whole time — and a resolution step is exactly where a
 * casing or form difference from the literal path Node created the fixture
 * with could creep in on a case-insensitive filesystem. `samePath` already
 * exists for this reason elsewhere in the app; this is the same comparison.
 */
export function reasonForGitPath(
  changedPath: string,
  paths: GitWatchPaths,
  platform: NodeJS.Platform = process.platform
): WorktreeChangeReason | null {
  const normalisedChanged = normaliseForCompare(changedPath, platform)
  if (normalisedChanged === normaliseForCompare(paths.index, platform)) return 'index'
  if (normalisedChanged === normaliseForCompare(paths.head, platform)) return 'head'
  if (normalisedChanged === normaliseForCompare(paths.packedRefs, platform)) return 'refs'
  const normalisedRefsHeads = normaliseForCompare(paths.refsHeads, platform)
  const refsHeadsPrefix = normalisedRefsHeads + (platform === 'win32' ? '\\' : '/')
  if (normalisedChanged === normalisedRefsHeads || normalisedChanged.startsWith(refsHeadsPrefix)) {
    return 'refs'
  }
  return null
}
