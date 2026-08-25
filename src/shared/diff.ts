/**
 * A pure parser for unified diff text, as `git diff`/`git show` produce it
 * with the flag preamble the diff panel always uses (`--no-ext-diff
 * --no-color --no-textconv -U3 --src-prefix=a/ --dst-prefix=b/ -M`).
 *
 * Line indices here are indices into `text.split('\n')` with a trailing
 * empty element (from a final `\n`) dropped — exactly how a `0x0A`-split of
 * the raw output buffer indexes lines, which is what makes byte-accurate
 * slicing possible: UTF-8 decoding never invents or removes a newline, so a
 * line index computed from the decoded string always lines up with the same
 * index computed from the raw bytes.
 */

export type DiffLineKind = 'context' | 'add' | 'remove' | 'no-newline'

export interface DiffLine {
  kind: DiffLineKind
  /** The line's text, without its leading ` `/`+`/`-` marker. */
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
  /** Inclusive line-index range into the diff text this hunk came from, header included. */
  lineRange: { start: number; end: number }
  /**
   * 12 hex characters of a sha1 over the hunk's raw bytes (the `@@` header
   * included), computed in main from the same buffer `lineRange` slices —
   * `crypto` is forbidden here in `src/shared`. Never set by
   * `parseUnifiedDiff` itself, the same way `FileDiff.lossy` never is: only
   * main has the raw buffer to hash. The renderer sends this back on
   * `worktree:applyHunk` to say which hunk to stage or unstage; main
   * re-diffs fresh and looks it up by id rather than trusting a cached copy,
   * so a stale id (the file changed since the diff was shown) simply fails
   * to match anything instead of needing its own staleness check.
   */
  id?: string
}

export type FileChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'mode-change'

export interface FileDiff {
  oldPath: string | null
  newPath: string | null
  changeKind: FileChangeKind
  oldMode: string | null
  newMode: string | null
  /** Rename/copy similarity percentage, or null when this isn't a rename. */
  similarity: number | null
  binary: boolean
  hunks: DiffHunk[]
  /**
   * Set when re-encoding the decoded text doesn't reproduce the original
   * bytes, so the panel can say the diff is approximate rather than render
   * mojibake with no explanation. Never set by `parseUnifiedDiff` itself —
   * only main has the raw buffer to check this against.
   */
  lossy?: boolean
  /**
   * Set when this file's hunks were cut short at `MAX_DIFF_LINES` — the
   * DTO's own protection, since a 50k-line diff would otherwise lock up the
   * renderer that has to lay it out, not just slow down the IPC call.
   */
  truncated?: boolean
}

/** The line-count cap `truncateFileDiff` enforces. */
export const MAX_DIFF_LINES = 2000

/**
 * Cuts a file's hunks short at `MAX_DIFF_LINES` total lines across all of
 * them, dropping any hunk that would start past the cap entirely rather
 * than splitting one mid-hunk.
 */
export function truncateFileDiff(file: FileDiff): FileDiff {
  let total = 0
  const hunks: DiffHunk[] = []
  for (const hunk of file.hunks) {
    if (total >= MAX_DIFF_LINES) break
    if (total + hunk.lines.length <= MAX_DIFF_LINES) {
      hunks.push(hunk)
      total += hunk.lines.length
      continue
    }
    hunks.push({ ...hunk, lines: hunk.lines.slice(0, MAX_DIFF_LINES - total) })
    total = MAX_DIFF_LINES
  }
  if (
    hunks.length === file.hunks.length &&
    total === file.hunks.reduce((sum, h) => sum + h.lines.length, 0)
  ) {
    return file
  }
  return { ...file, hunks, truncated: true }
}

/**
 * Whether a file's change has nothing a hunk can represent — a mode-only
 * flip, a pure rename, or a binary file — so "stage this hunk" is
 * meaningless and the panel has to offer whole-file staging instead. A
 * `'modified'` file with no hunks is different: that means git found no
 * difference at all (see `#parseDiffBuffer`'s empty-output case), and there
 * is nothing to stage either way.
 */
export function isHunklessChange(file: FileDiff): boolean {
  if (file.binary) return true
  return file.hunks.length === 0 && file.changeKind !== 'modified'
}

/**
 * Whether `line` is one of the lines `worktree:applyHunk`'s single-hunk
 * patch needs from the header shared by every hunk in a file's diff —
 * mirrors the prefixes `parseUnifiedDiff`'s own header scan below
 * recognises, except `index <old>..<new>`, deliberately left out: verified
 * that `git apply` doesn't need it, and it's actively misleading when only
 * one hunk of the file is included. The `diff --git` line itself is always
 * the header's first line, so callers add that separately rather than
 * through this.
 */
export function isPatchHeaderLine(line: string): boolean {
  return (
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ')
  )
}

/** Insertions and deletions across every hunk, for the panel's header. */
export function diffStats(file: FileDiff): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') insertions++
      else if (line.kind === 'remove') deletions++
    }
  }
  return { insertions, deletions }
}

/**
 * What to diff, and against what. `origPath` carries a rename's other name
 * — both paths have to be passed to git together, or a rename filtered by
 * one path reports as a brand new file with the whole content added.
 */
export type DiffRequest =
  | { kind: 'unstaged' | 'staged'; worktreePath: string; path: string; origPath?: string | null }
  | { kind: 'untracked'; worktreePath: string; path: string }
  | { kind: 'commit'; repoPath: string; hash: string; path: string; origPath?: string | null }

/**
 * The paths to pass `workingTree:stage`/`workingTree:unstage` for a
 * hunk-less file's whole-file staging offer: both sides of a rename, or
 * just the path. Mirrors `stagePathsFor` in `working-tree.ts`, which takes
 * a `ChangedFile` rather than a `DiffRequest` — the diff panel has the
 * latter, not the former, for a file opened from a commit or an inspector
 * restored from persisted selection.
 */
export function wholeFilePathsFor(request: DiffRequest): string[] {
  if (request.kind === 'untracked') return [request.path]
  return request.origPath && request.origPath !== request.path
    ? [request.origPath, request.path]
    : [request.path]
}

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  // A trailing '\n' produces one dangling empty element from split(); drop
  // it so line indices match a 0x0A split of the raw bytes, which has none.
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

function parseDiffGitHeader(line: string): { a: string; b: string } {
  const rest = line.slice('diff --git '.length)
  const marker = ' b/'
  const splitAt = rest.lastIndexOf(marker)
  if (splitAt === -1) return { a: rest, b: rest }
  return { a: rest.slice(0, splitAt).replace(/^a\//, ''), b: rest.slice(splitAt + marker.length) }
}

/** Strips the `a/`/`b/` prefix `--src-prefix`/`--dst-prefix` add; null for `/dev/null`. */
function sidePath(raw: string, prefix: 'a/' | 'b/'): string | null {
  if (raw === '/dev/null') return null
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
}

function parseHunk(lines: string[], headerIndex: number): { hunk: DiffHunk; next: number } {
  const match = HUNK_HEADER.exec(lines[headerIndex] ?? '')
  const oldStart = match ? Number(match[1]) : 0
  const oldLines = match ? (match[2] !== undefined ? Number(match[2]) : 1) : 0
  const newStart = match ? Number(match[3]) : 0
  const newLines = match ? (match[4] !== undefined ? Number(match[4]) : 1) : 0

  const body: DiffLine[] = []
  let oldLine = oldStart
  let newLine = newStart
  let consumedOld = 0
  let consumedNew = 0
  let i = headerIndex + 1

  while (i < lines.length) {
    const raw = lines[i] ?? ''
    // A no-newline marker can trail the hunk's very last line, after the
    // old/new counts are already both met, so it's consumed unconditionally
    // rather than gated by the count check below.
    if (raw.startsWith('\\')) {
      body.push({ kind: 'no-newline', text: raw.slice(2), oldLine: null, newLine: null })
      i++
      continue
    }
    if (consumedOld >= oldLines && consumedNew >= newLines) break

    const marker = raw[0] ?? ' '
    const text = raw.slice(1)
    if (marker === ' ') {
      body.push({ kind: 'context', text, oldLine, newLine })
      oldLine++
      newLine++
      consumedOld++
      consumedNew++
    } else if (marker === '-') {
      body.push({ kind: 'remove', text, oldLine, newLine: null })
      oldLine++
      consumedOld++
    } else if (marker === '+') {
      body.push({ kind: 'add', text, oldLine: null, newLine })
      newLine++
      consumedNew++
    } else {
      // Malformed input (or a stray blank line git's own output doesn't
      // produce): stop rather than looping forever short of the target.
      break
    }
    i++
  }

  return {
    hunk: {
      header: lines[headerIndex] ?? '',
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines: body,
      lineRange: { start: headerIndex, end: i - 1 }
    },
    next: i
  }
}

function isFileOrHunkBoundary(line: string): boolean {
  return line.startsWith('diff --git ') || line.startsWith('@@ ')
}

function changeKindOf(
  isNewFile: boolean,
  isDeleted: boolean,
  renamed: boolean,
  hasContentLines: boolean,
  hasModeChange: boolean
): FileChangeKind {
  if (isNewFile) return 'added'
  if (isDeleted) return 'deleted'
  if (renamed) return 'renamed'
  if (!hasContentLines && hasModeChange) return 'mode-change'
  return 'modified'
}

/**
 * Parses the output of `git diff`/`git show` run with this app's flag
 * preamble. Covers: a mode-only change (no `---`/`+++`, no hunks); a new or
 * deleted file; a rename/copy (`similarity index` + `rename from`/`rename
 * to`, or `copy from`/`copy to`); a binary file (`Binary files ... differ`,
 * no hunks); `\ No newline at end of file` on either side of a hunk, its own
 * line kind so it survives being rebuilt byte-exactly; and `@@ -a,b +c,d @@`
 * headers where `b`/`d` default to 1 when omitted.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const lines = splitLines(text)
  const files: FileDiff[] = []
  let i = 0

  while (i < lines.length) {
    if (!(lines[i] ?? '').startsWith('diff --git ')) {
      i++
      continue
    }

    const headerPaths = parseDiffGitHeader(lines[i] ?? '')
    i++

    let oldMode: string | null = null
    let newMode: string | null = null
    let isNewFile = false
    let isDeleted = false
    let hasModeChange = false
    let similarity: number | null = null
    let renameFrom: string | null = null
    let renameTo: string | null = null
    let binary = false
    let oldPath: string | null | undefined
    let newPath: string | null | undefined

    while (i < lines.length && !isFileOrHunkBoundary(lines[i] ?? '')) {
      const line = lines[i] ?? ''
      if (line.startsWith('old mode ')) {
        oldMode = line.slice('old mode '.length)
        hasModeChange = true
      } else if (line.startsWith('new mode ')) {
        newMode = line.slice('new mode '.length)
        hasModeChange = true
      } else if (line.startsWith('new file mode ')) {
        isNewFile = true
        newMode = line.slice('new file mode '.length)
      } else if (line.startsWith('deleted file mode ')) {
        isDeleted = true
        oldMode = line.slice('deleted file mode '.length)
      } else if (line.startsWith('similarity index ')) {
        similarity = Number.parseInt(line.slice('similarity index '.length), 10)
      } else if (line.startsWith('rename from ')) {
        renameFrom = line.slice('rename from '.length)
      } else if (line.startsWith('rename to ')) {
        renameTo = line.slice('rename to '.length)
      } else if (line.startsWith('copy from ')) {
        renameFrom = line.slice('copy from '.length)
      } else if (line.startsWith('copy to ')) {
        renameTo = line.slice('copy to '.length)
      } else if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
        binary = true
      } else if (line.startsWith('--- ')) {
        oldPath = sidePath(line.slice(4), 'a/')
      } else if (line.startsWith('+++ ')) {
        newPath = sidePath(line.slice(4), 'b/')
      }
      // `index <old>..<new> [mode]` carries nothing this panel needs: the
      // blobs aren't shown, and mode already comes from old/new mode lines.
      i++
    }

    const hunks: DiffHunk[] = []
    while (i < lines.length && (lines[i] ?? '').startsWith('@@ ')) {
      const { hunk, next } = parseHunk(lines, i)
      hunks.push(hunk)
      i = next
    }

    const renamed = renameFrom !== null && renameTo !== null
    files.push({
      oldPath: renameFrom ?? (oldPath !== undefined ? oldPath : headerPaths.a),
      newPath: renameTo ?? (newPath !== undefined ? newPath : headerPaths.b),
      changeKind: changeKindOf(isNewFile, isDeleted, renamed, hunks.length > 0, hasModeChange),
      oldMode,
      newMode,
      similarity: Number.isNaN(similarity as number) ? null : similarity,
      binary,
      hunks
    })
  }

  return files
}

/**
 * Builds the `FileDiff` an untracked file gets without a git call: `git diff
 * --no-index -- /dev/null <path>` exits 1 for "differences found", which
 * fights `runOrThrow`, and `/dev/null` is platform-dependent on Windows.
 * `content` is `null` for a binary file, sniffed by the caller before this
 * runs — there is nothing here that needs the bytes.
 */
export function syntheticNewFileDiff(path: string, content: string | null): FileDiff {
  const base: FileDiff = {
    oldPath: null,
    newPath: path,
    changeKind: 'added',
    oldMode: null,
    newMode: null,
    similarity: null,
    binary: content === null,
    hunks: []
  }
  if (content === null || content === '') return base

  const endsWithNewline = content.endsWith('\n')
  const bodyText = endsWithNewline ? content.slice(0, -1) : content
  const bodyLines = bodyText.split('\n')
  const lines: DiffLine[] = bodyLines.map((text, index) => ({
    kind: 'add',
    text,
    oldLine: null,
    newLine: index + 1
  }))
  if (!endsWithNewline) {
    lines.push({
      kind: 'no-newline',
      text: 'No newline at end of file',
      oldLine: null,
      newLine: null
    })
  }

  return {
    ...base,
    hunks: [
      {
        header: `@@ -0,0 +1,${bodyLines.length} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: bodyLines.length,
        lines,
        lineRange: { start: 0, end: lines.length - 1 }
      }
    ]
  }
}
