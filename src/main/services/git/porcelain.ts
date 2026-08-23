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
  ChangeCode,
  ChangedFile,
  CommitLogEntry,
  CommitSummary,
  StatusBranch,
  UnmergedCode,
  UpstreamTrack,
  WorkingTreeChanges,
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

/**
 * Splits NUL-terminated output from a `-z` git command into records, minus
 * the trailing empty field the final terminator produces. Fields inside one
 * record are then found without `\0` at all — the exception being a `2`
 * (rename/copy) record, whose original path is a *separate* NUL-terminated
 * field that follows it, which is why callers walk this with an index
 * cursor rather than mapping over it directly.
 */
function splitNulRecords(output: string): string[] {
  const parts = output.split(FIELD_SEPARATOR)
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts
}

/** Takes `n` space-separated leading fields off `s`, returning them plus whatever remains. */
function takeFields(s: string, n: number): [fields: string[], rest: string] {
  const fields: string[] = []
  let rest = s
  for (let k = 0; k < n; k++) {
    const index = rest.indexOf(' ')
    if (index === -1) {
      fields.push(rest)
      rest = ''
      break
    }
    fields.push(rest.slice(0, index))
    rest = rest.slice(index + 1)
  }
  return [fields, rest]
}

/** The submodule field is `N...` (not a submodule) or `S<c><m><u>`, each position the letter or `.`. */
function parseSubmoduleField(sub: string | undefined): ChangedFile['submodule'] {
  if (!sub || sub[0] !== 'S') return null
  return {
    commitChanged: sub[1] === 'C',
    modifiedTracked: sub[2] === 'M',
    untracked: sub[3] === 'U'
  }
}

/** The `<R|C><score>` field on a `2` record, e.g. `R100`. */
function parseScoreField(field: string | undefined): number | null {
  if (!field) return null
  const score = Number(field.slice(1))
  return Number.isFinite(score) ? score : null
}

function parseOrdinaryRecord(record: string): ChangedFile {
  const [fields, path] = takeFields(record.slice(2), 7)
  const [xy, sub] = fields
  return {
    path,
    kind: 'tracked',
    index: (xy?.[0] ?? '.') as ChangeCode,
    worktree: (xy?.[1] ?? '.') as ChangeCode,
    origPath: null,
    score: null,
    conflict: null,
    submodule: parseSubmoduleField(sub)
  }
}

function parseRenameRecord(record: string, origPath: string): ChangedFile {
  const [fields, path] = takeFields(record.slice(2), 8)
  const [xy, sub, , , , , , scoreField] = fields
  return {
    path,
    kind: 'tracked',
    index: (xy?.[0] ?? '.') as ChangeCode,
    worktree: (xy?.[1] ?? '.') as ChangeCode,
    origPath,
    score: parseScoreField(scoreField),
    conflict: null,
    submodule: parseSubmoduleField(sub)
  }
}

function parseUnmergedRecord(record: string): ChangedFile {
  const [fields, path] = takeFields(record.slice(2), 9)
  const [xy, sub] = fields
  return {
    path,
    kind: 'unmerged',
    // The unmerged XY alphabet (D/A/U) doesn't fit ChangeCode (no 'U'); the
    // two-letter state lives entirely in `conflict` instead.
    index: '.',
    worktree: '.',
    origPath: null,
    score: null,
    conflict: (xy ?? null) as UnmergedCode | null,
    submodule: parseSubmoduleField(sub)
  }
}

function parseUntrackedOrIgnoredRecord(record: string, kind: 'untracked' | 'ignored'): ChangedFile {
  return {
    path: record.slice(2),
    kind,
    index: '.',
    worktree: '.',
    origPath: null,
    score: null,
    conflict: null,
    submodule: null
  }
}

function applyBranchHeader(rest: string, branch: StatusBranch): void {
  const spaceIndex = rest.indexOf(' ')
  const key = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex)
  const value = spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1)

  switch (key) {
    case 'branch.oid':
      branch.oid = value === '(initial)' ? null : value
      break
    case 'branch.head':
      branch.detached = value === '(detached)'
      branch.head = branch.detached ? null : value
      break
    case 'branch.upstream':
      branch.upstream = value
      break
    case 'branch.ab': {
      const match = /^\+(\d+)\s+-(\d+)$/.exec(value)
      if (match) {
        branch.ahead = Number(match[1])
        branch.behind = Number(match[2])
      }
      break
    }
  }
}

/**
 * Parses `git status --porcelain=v2 -z --branch --untracked-files=all`.
 * `parseStatus` above stays exactly as it is — this is a separate parser for
 * the richer per-file detail the Working Tree tab needs, not a replacement.
 *
 * `-z` is mandatory, not an optimisation: without it git C-quotes paths
 * containing spaces. See `splitNulRecords` for the field-count subtlety a
 * naive `.split('\0')` gets wrong on a rename record.
 */
export function parseStatusV2(output: string): WorkingTreeChanges {
  const branch: StatusBranch = {
    oid: null,
    head: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0
  }
  const files: ChangedFile[] = []

  const records = splitNulRecords(output)
  let i = 0
  while (i < records.length) {
    const record = records[i]
    if (record === undefined || record === '') {
      i++
      continue
    }

    if (record.startsWith('# ')) {
      applyBranchHeader(record.slice(2), branch)
      i++
      continue
    }

    switch (record[0]) {
      case '1':
        files.push(parseOrdinaryRecord(record))
        i++
        break
      case '2':
        files.push(parseRenameRecord(record, records[i + 1] ?? ''))
        i += 2
        break
      case 'u':
        files.push(parseUnmergedRecord(record))
        i++
        break
      case '?':
        files.push(parseUntrackedOrIgnoredRecord(record, 'untracked'))
        i++
        break
      case '!':
        files.push(parseUntrackedOrIgnoredRecord(record, 'ignored'))
        i++
        break
      default:
        i++
    }
  }

  return { branch, files }
}

/**
 * Rolls `parseStatusV2`'s richer output up to the shape `parseStatus`
 * returns, matching its counting rule exactly: an unmerged file, whose two
 * sides are never `.`, counts toward both `staged` and `unstaged` just as an
 * unmerged `XY` line does under v1. This parity is what will one day let the
 * refresh pipeline collapse to a single status call — not done in this PR.
 */
export function countsFromV2(changes: WorkingTreeChanges): WorkingTreeStatus {
  let staged = 0
  let unstaged = 0
  let untracked = 0

  for (const file of changes.files) {
    if (file.kind === 'untracked') {
      untracked++
      continue
    }
    if (file.kind === 'ignored') continue
    if (file.kind === 'unmerged') {
      staged++
      unstaged++
      continue
    }
    if (file.index !== '.') staged++
    if (file.worktree !== '.') unstaged++
  }

  return { dirty: staged + unstaged + untracked > 0, staged, unstaged, untracked }
}
