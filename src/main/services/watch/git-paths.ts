import { isAbsolute, join, sep } from 'path'
import type { GitRunner } from '../git/git-runner'
import type { WorktreeChangeReason } from '../../../shared/ipc-contract'

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
 */
export function reasonForGitPath(
  changedPath: string,
  paths: GitWatchPaths
): WorktreeChangeReason | null {
  if (changedPath === paths.index) return 'index'
  if (changedPath === paths.head) return 'head'
  if (changedPath === paths.packedRefs) return 'refs'
  const refsHeadsPrefix = paths.refsHeads.endsWith(sep) ? paths.refsHeads : paths.refsHeads + sep
  if (changedPath === paths.refsHeads || changedPath.startsWith(refsHeadsPrefix)) return 'refs'
  return null
}
