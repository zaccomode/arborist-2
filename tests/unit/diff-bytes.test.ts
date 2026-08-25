import { describe, it, expect } from 'vitest'
import { lineByteRanges } from '../../src/main/services/git/diff-bytes'

describe('lineByteRanges', () => {
  it('gives one range per line, excluding the newline byte itself', () => {
    const buffer = Buffer.from('line1\nline2\nline3', 'utf8')

    const ranges = lineByteRanges(buffer)

    expect(ranges).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 12, end: 17 }
    ])
    expect(ranges.map((range) => buffer.subarray(range.start, range.end).toString('utf8'))).toEqual(
      ['line1', 'line2', 'line3']
    )
  })

  it('has no dangling range for a trailing newline', () => {
    const buffer = Buffer.from('a\nb\n', 'utf8')

    expect(lineByteRanges(buffer)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 }
    ])
  })

  it('returns nothing for an empty buffer', () => {
    expect(lineByteRanges(Buffer.alloc(0))).toEqual([])
  })

  it('matches split("\\n") line count on a file that does not round-trip through UTF-8', () => {
    // 0xE9 alone is not valid UTF-8 (it's a lead byte for a 3-byte sequence
    // with nothing following); decoding replaces it with one U+FFFD rather
    // than consuming or injecting a 0x0A, so the byte-derived line count and
    // the string-derived line count must still agree. This is the invariant
    // `parseUnifiedDiff`'s line indices depend on to slice these same bytes.
    const buffer = Buffer.from([0x61, 0x0a, 0xe9, 0x62, 0x0a, 0x63])

    const ranges = lineByteRanges(buffer)
    const decodedLines = buffer.toString('utf8').split('\n')

    expect(buffer.toString('utf8')).toContain('�')
    expect(ranges).toHaveLength(3)
    expect(ranges).toHaveLength(decodedLines.length)
  })
})
