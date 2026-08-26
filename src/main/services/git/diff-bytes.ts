import { createHash } from 'crypto'

export interface ByteRange {
  start: number
  end: number
}

/**
 * The byte offset range of each line in `buffer`, split on `0x0A`. Line
 * index `i` here always matches line index `i` in
 * `buffer.toString('utf8').split('\n')` (with a trailing empty element
 * dropped), because UTF-8 decoding never invents or removes a newline:
 * `0x0A` cannot occur inside a multi-byte sequence, and an invalid byte
 * becomes one U+FFFD rather than a newline. That equivalence is what makes
 * `parseUnifiedDiff`'s line indices usable to slice the raw bytes — see
 * `tests/unit/diff-bytes.test.ts` for the invariant asserted directly
 * against a file that doesn't round-trip through UTF-8.
 */
export function lineByteRanges(buffer: Buffer): ByteRange[] {
  const ranges: ByteRange[] = []
  let start = 0
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) {
      ranges.push({ start, end: i })
      start = i + 1
    }
  }
  if (start < buffer.length) ranges.push({ start, end: buffer.length })
  return ranges
}

/**
 * The bytes lines `start` through `end` (inclusive, indices into
 * `lineRanges`) span, with each line's trailing `\n` included where the
 * buffer has one — found by reading up to where the *next* line starts
 * rather than assuming one, so this is correct even for the buffer's own
 * final line, which may have no trailing newline at all.
 */
export function sliceLines(
  buffer: Buffer,
  lineRanges: ByteRange[],
  start: number,
  end: number
): Buffer {
  const startByte = lineRanges[start]?.start ?? 0
  const nextStart = lineRanges[end + 1]?.start ?? buffer.length
  return buffer.subarray(startByte, nextStart)
}

/** One line's bytes, trailing `\n` included when the buffer has one. */
export function sliceLine(buffer: Buffer, lineRanges: ByteRange[], index: number): Buffer {
  if (!lineRanges[index]) return Buffer.alloc(0)
  return sliceLines(buffer, lineRanges, index, index)
}

/**
 * 12 hex characters of a sha1 over the raw bytes lines `range` spans (a
 * hunk's `@@` header included, since `DiffHunk.lineRange` always starts
 * there) — the id `worktree:applyHunk` matches a hunk by. Two different
 * files could in principle hash to the same 12 hex characters; `applyHunk`
 * re-parses fresh and matches within one file's hunks, not across the
 * whole repository, so that collision space is small enough to accept.
 */
export function hunkId(
  buffer: Buffer,
  lineRanges: ByteRange[],
  range: { start: number; end: number }
): string {
  return createHash('sha1')
    .update(sliceLines(buffer, lineRanges, range.start, range.end))
    .digest('hex')
    .slice(0, 12)
}
