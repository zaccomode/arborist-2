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
