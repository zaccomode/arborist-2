import { promises as fs } from 'fs'
import { isAbsolute, join } from 'path'
import type { ConflictOperation, ConflictState } from '../../../shared/conflicts'
import { parseMergeSourceFromMsg, shortRefName } from '../../../shared/conflicts'
import type { GitRunner } from './git-runner'

/**
 * Resolves one of git's own `--git-path` locations under `worktreePath` and
 * stats it — the sanctioned way to ask "is a merge/rebase/etc in progress"
 * per the house rule against stderr-based control flow. `rev-parse
 * --git-path` exits 0 and echoes back even a name git doesn't recognise, so
 * the stat is what actually decides this, not the exit code alone.
 */
async function gitPathIfExists(
  git: GitRunner,
  worktreePath: string,
  relative: string
): Promise<string | null> {
  const result = await git.run(['rev-parse', '--git-path', relative], { repoPath: worktreePath })
  if (result.exitCode !== 0) return null
  const raw = result.stdout.trim()
  if (!raw) return null
  const absolute = isAbsolute(raw) ? raw : join(worktreePath, raw)
  try {
    await fs.stat(absolute)
    return absolute
  } catch {
    return null
  }
}

async function readGitPathFile(
  git: GitRunner,
  worktreePath: string,
  relative: string
): Promise<string | null> {
  const absolute = await gitPathIfExists(git, worktreePath, relative)
  if (!absolute) return null
  try {
    return await fs.readFile(absolute, 'utf8')
  } catch {
    return null
  }
}

/**
 * Which operation, if any, has the worktree mid-conflict. Each state file is
 * checked independently rather than as a single if/else-if chain that stops
 * at the first hit by coincidence of file layout — `MERGE_HEAD` and a stray
 * `rebase-merge/` left over from an aborted rebase could in principle both
 * exist, and merge is the more specific, more recent thing to report.
 */
export async function detectConflictOperation(
  git: GitRunner,
  worktreePath: string
): Promise<ConflictOperation | null> {
  if (await gitPathIfExists(git, worktreePath, 'MERGE_HEAD')) return 'merge'
  if (await gitPathIfExists(git, worktreePath, 'CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (await gitPathIfExists(git, worktreePath, 'REVERT_HEAD')) return 'revert'
  if (await gitPathIfExists(git, worktreePath, 'REBASE_HEAD')) return 'rebase'
  if (await gitPathIfExists(git, worktreePath, 'rebase-merge')) return 'rebase'
  if (await gitPathIfExists(git, worktreePath, 'rebase-apply')) return 'rebase'
  return null
}

async function currentBranch(git: GitRunner, worktreePath: string): Promise<string | null> {
  const result = await git.run(['symbolic-ref', '--short', 'HEAD'], { repoPath: worktreePath })
  return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : null
}

async function shortHash(
  git: GitRunner,
  worktreePath: string,
  ref: string
): Promise<string | null> {
  const result = await git.run(['rev-parse', '--short', ref], { repoPath: worktreePath })
  return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : null
}

/**
 * `MERGE_MSG`'s first line names the branch, when git wrote one in a
 * recognisable shape; a hand-written or squash message falls back to a short
 * hash of `MERGE_HEAD`, which is always there.
 */
async function mergeSourceLabel(git: GitRunner, worktreePath: string): Promise<string | null> {
  const msg = await readGitPathFile(git, worktreePath, 'MERGE_MSG')
  const fromMsg = msg ? parseMergeSourceFromMsg(msg) : null
  if (fromMsg) return fromMsg
  return shortHash(git, worktreePath, 'MERGE_HEAD')
}

/**
 * HEAD is detached mid-rebase, so the branch it started from lives in
 * `rebase-merge/head-name` (or `rebase-apply/head-name` for the older
 * non-interactive backend) instead. `onto` is a bare commit sha either way —
 * resolved to a short hash rather than a branch name, since naming it back
 * to a ref would need a second, less certain lookup.
 */
async function rebaseLabels(
  git: GitRunner,
  worktreePath: string
): Promise<{ sourceLabel: string | null; targetLabel: string | null }> {
  const headName =
    (await readGitPathFile(git, worktreePath, 'rebase-merge/head-name')) ??
    (await readGitPathFile(git, worktreePath, 'rebase-apply/head-name'))
  const targetLabel = headName ? shortRefName(headName.trim()) : null

  const ontoSha =
    (await readGitPathFile(git, worktreePath, 'rebase-merge/onto')) ??
    (await readGitPathFile(git, worktreePath, 'rebase-apply/onto'))
  const sourceLabel = ontoSha ? await shortHash(git, worktreePath, ontoSha.trim()) : null

  return { sourceLabel, targetLabel }
}

/** Everything the Conflicts banner needs: which operation, and who's involved. */
export async function detectConflictState(
  git: GitRunner,
  worktreePath: string
): Promise<ConflictState> {
  const operation = await detectConflictOperation(git, worktreePath)
  if (!operation) return { operation: null, sourceLabel: null, targetLabel: null }

  if (operation === 'merge') {
    const [sourceLabel, targetLabel] = await Promise.all([
      mergeSourceLabel(git, worktreePath),
      currentBranch(git, worktreePath)
    ])
    return { operation, sourceLabel, targetLabel }
  }

  if (operation === 'rebase') {
    const { sourceLabel, targetLabel } = await rebaseLabels(git, worktreePath)
    return { operation, sourceLabel, targetLabel }
  }

  // Cherry-pick and revert: the commit being applied is the whole story,
  // named by its own head file; the branch it's landing on is just HEAD.
  const headFile = operation === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : 'REVERT_HEAD'
  const [sourceSha, targetLabel] = await Promise.all([
    readGitPathFile(git, worktreePath, headFile),
    currentBranch(git, worktreePath)
  ])
  const sourceLabel = sourceSha ? await shortHash(git, worktreePath, sourceSha.trim()) : null
  return { operation, sourceLabel, targetLabel }
}
