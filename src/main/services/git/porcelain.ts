/**
 * Parsers for the git output formats the app consumes.
 *
 * Everything here is a pure string-to-domain-type function: no child_process,
 * no fs. Every badge in the sidebar is downstream of this file, which makes it
 * the highest-value unit-test surface in the codebase, and that is only true
 * while it stays testable without a repository.
 */
import type {
  AheadBehind,
  BranchInfo,
  CommitLogEntry,
  CommitSummary,
  UpstreamTrack,
  WorkingTreeStatus,
  WorktreeEntry
} from '../../../shared/domain'
import { normaliseGitPath } from '../../../shared/paths'

function splitLines(output: string): string[] {
  return output.split(/\r?\n/)
}

/** Splits `key value` where the value may itself contain spaces, or is absent. */
function splitRecord(line: string): [key: string, value: string | null] {
  const index = line.indexOf(' ')
  if (index === -1) return [line, null]
  return [line.slice(0, index), line.slice(index + 1)]
}

/**
 * Parses `git worktree list --porcelain`: stanzas of `key value` records
 * separated by blank lines.
 *
 * The first stanza is always the repository's own worktree. v1 instead
 * identified it by the `bare` marker, which is absent in a normal repository,
 * so no worktree was ever protected from deletion.
 */
export function parseWorktreeList(
  output: string,
  platform: NodeJS.Platform = process.platform
): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | null = null

  const finish = (): void => {
    if (current) entries.push(current)
    current = null
  }

  for (const line of splitLines(output)) {
    if (line.trim() === '') {
      finish()
      continue
    }

    const [key, value] = splitRecord(line)

    if (key === 'worktree') {
      finish()
      current = {
        path: normaliseGitPath(value ?? '', platform),
        head: null,
        branch: null,
        isMain: entries.length === 0,
        isBare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null
      }
      continue
    }

    if (!current) continue

    switch (key) {
      case 'HEAD':
        current.head = value
        break
      case 'branch':
        current.branch = value ? value.replace(/^refs\/heads\//, '') : null
        break
      case 'bare':
        current.isBare = true
        break
      case 'detached':
        current.branch = null
        break
      case 'locked':
        current.locked = true
        current.lockReason = value
        break
      case 'prunable':
        current.prunable = true
        current.prunableReason = value
        break
    }
  }

  finish()
  return entries
}

/**
 * Parses `git branch --list --format=%(refname:short)%(HEAD)`, where the
 * checked-out branch carries a trailing `*`.
 */
export function parseBranchList(output: string): BranchInfo[] {
  return splitLines(output)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      line.endsWith('*')
        ? { name: line.slice(0, -1).trim(), current: true }
        : { name: line, current: false }
    )
    .filter((branch) => branch.name.length > 0)
}

/**
 * Parses `git branch -r --list --format=%(refname:short)`, dropping the
 * symbolic `origin/HEAD` entries, which are not branches anyone can check
 * out. Git 2.55 (unlike 2.43, where this app's own tests were first
 * written) also prints a bare remote name — just `origin`, no slash — for
 * that same symbolic ref on some setups; a real remote branch always has
 * the shape `<remote>/<path>`, so requiring a slash drops it under either
 * git version rather than chasing the exact string each one prints.
 */
export function parseRemoteBranchList(output: string): string[] {
  return splitLines(output)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes('/') && !/(^|\/)HEAD$/.test(line))
}

/**
 * Parses `git rev-list --count --left-right HEAD...@{upstream}`, which prints
 * the two counts separated by a tab. HEAD is on the left, so the left count is
 * how far ahead the branch is and the right is how far behind.
 */
export function parseAheadBehind(output: string): AheadBehind | null {
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(output)
  if (!match) return null
  return { ahead: Number(match[1]), behind: Number(match[2]) }
}

/**
 * Parses git's `%(upstream:track)`, which reads `[ahead 2, behind 1]`,
 * `[gone]`, or nothing at all.
 *
 * `[gone]` is why the refresh pipeline asks for this rather than counting with
 * rev-list: once the remote-tracking ref is pruned, `@{upstream}` stops
 * resolving entirely, and a deleted upstream would be indistinguishable from a
 * branch that was never pushed. They are different badges.
 */
export function parseUpstreamTrack(value: string): UpstreamTrack {
  const track = value.trim()
  if (track === '[gone]') return { ahead: 0, behind: 0, gone: true }

  const ahead = /\bahead (\d+)/.exec(track)
  const behind = /\bbehind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: false
  }
}

/**
 * NUL separates the fields below, because a commit subject can contain
 * anything else. The format asks for `%x00` rather than carrying the
 * character itself, since an argv entry cannot hold a NUL.
 */
export const FIELD_SEPARATOR = '\u0000'

export const COMMIT_FORMAT = ['%H', '%h', '%an', '%aI', '%s'].join('%x00')

/** Parses one commit written with `COMMIT_FORMAT`. */
export function parseCommit(output: string): CommitSummary | null {
  const fields = output.replace(/\r?\n$/, '').split(FIELD_SEPARATOR)
  if (fields.length < 5 || !fields[0]) return null
  return {
    hash: fields[0],
    shortHash: fields[1],
    author: fields[2],
    date: fields[3],
    subject: fields[4]
  }
}

/**
 * Record and unit separators for `git log --shortstat`, where a commit
 * subject can contain quotes, pipes, or anything else a human-typed
 * delimiter would need escaping for. The record separator opens every
 * commit, `%x1e`, so a chunk can be found and split off regardless of what
 * the shortstat line under it says; the unit separator, `%x1f`, then splits
 * that chunk's own fields.
 */
export const LOG_RECORD_SEPARATOR = '\u001e'
export const LOG_FIELD_SEPARATOR = '\u001f'

export const LOG_FORMAT = ['%H', '%h', '%an', '%ad', '%s'].join(LOG_FIELD_SEPARATOR)

/**
 * Matches `git --shortstat`'s one summary line. Each count is its own
 * optional group because git omits whichever ones are zero: a rename-only
 * commit prints just "1 file changed", with neither insertions nor
 * deletions.
 */
const SHORTSTAT = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/

/**
 * Parses `git log --shortstat --format=${LOG_RECORD_SEPARATOR}${LOG_FORMAT}`
 * (see `commitLog` in `git-service.ts` for the full invocation) into one
 * entry per commit, newest first.
 */
export function parseCommitLog(output: string): CommitLogEntry[] {
  return output
    .split(LOG_RECORD_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const [header = '', ...rest] = chunk.split(/\r?\n/)
      const [hash, shortHash, author, date, subject] = header.split(LOG_FIELD_SEPARATOR)
      if (!hash) return null

      const stats = SHORTSTAT.exec(rest.join('\n'))
      return {
        hash,
        shortHash: shortHash ?? '',
        author: author ?? '',
        date: date ?? '',
        subject: subject ?? '',
        filesChanged: Number(stats?.[1] ?? 0),
        insertions: Number(stats?.[2] ?? 0),
        deletions: Number(stats?.[3] ?? 0)
      }
    })
    .filter((entry): entry is CommitLogEntry => entry !== null)
}

/**
 * Parses `git status --porcelain`. The first two characters of each line are
 * the index and worktree states; `??` is an untracked path.
 */
export function parseStatus(output: string): WorkingTreeStatus {
  let staged = 0
  let unstaged = 0
  let untracked = 0

  for (const line of splitLines(output)) {
    if (line.length < 2) continue
    const index = line[0]
    const worktree = line[1]

    if (index === '?' && worktree === '?') {
      untracked++
      continue
    }
    if (index !== ' ') staged++
    if (worktree !== ' ') unstaged++
  }

  return { dirty: staged + unstaged + untracked > 0, staged, unstaged, untracked }
}
