import { describe, it, expect } from 'vitest'
import {
  hunkId,
  lineByteRanges,
  sliceLine,
  sliceLines
} from '../../src/main/services/git/diff-bytes'

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

describe('sliceLines', () => {
  it('includes each line’s trailing newline except the buffer’s very last one', () => {
    const buffer = Buffer.from('a\nb\nc', 'utf8')
    const ranges = lineByteRanges(buffer)

    expect(sliceLines(buffer, ranges, 0, 1).toString('utf8')).toBe('a\nb\n')
    expect(sliceLines(buffer, ranges, 1, 2).toString('utf8')).toBe('b\nc')
    expect(sliceLines(buffer, ranges, 0, 2).toString('utf8')).toBe(buffer.toString('utf8'))
  })

  it('is byte-exact for a line that does not round-trip through UTF-8', () => {
    const buffer = Buffer.from([0x61, 0x0a, 0xe9, 0x0a, 0x62])
    const ranges = lineByteRanges(buffer)

    expect(sliceLines(buffer, ranges, 1, 1)).toEqual(Buffer.from([0xe9, 0x0a]))
  })
})

describe('sliceLine', () => {
  it('matches sliceLines for the same single index', () => {
    const buffer = Buffer.from('a\nb\nc\n', 'utf8')
    const ranges = lineByteRanges(buffer)

    expect(sliceLine(buffer, ranges, 1)).toEqual(sliceLines(buffer, ranges, 1, 1))
  })

  it('is empty for an out-of-range index', () => {
    const buffer = Buffer.from('a\n', 'utf8')
    const ranges = lineByteRanges(buffer)

    expect(sliceLine(buffer, ranges, 5)).toEqual(Buffer.alloc(0))
  })
})

describe('hunkId', () => {
  it('is 12 hex characters', () => {
    const buffer = Buffer.from('@@ -1,1 +1,1 @@\n-old\n+new\n', 'utf8')
    const ranges = lineByteRanges(buffer)

    const id = hunkId(buffer, ranges, { start: 0, end: 2 })

    expect(id).toMatch(/^[0-9a-f]{12}$/)
  })

  it('is stable for the same bytes and changes when a byte does', () => {
    const buffer = Buffer.from('@@ -1,1 +1,1 @@\n-old\n+new\n', 'utf8')
    const ranges = lineByteRanges(buffer)
    const range = { start: 0, end: 2 }

    expect(hunkId(buffer, ranges, range)).toBe(hunkId(buffer, ranges, range))

    const edited = Buffer.from('@@ -1,1 +1,1 @@\n-old\n+NEW\n', 'utf8')
    const editedRanges = lineByteRanges(edited)
    expect(hunkId(edited, editedRanges, range)).not.toBe(hunkId(buffer, ranges, range))
  })

  it('only covers the given line range, not the whole buffer', () => {
    const buffer = Buffer.from('header\n@@ -1,1 +1,1 @@\n-old\n+new\n', 'utf8')
    const ranges = lineByteRanges(buffer)

    const withoutHeader = hunkId(buffer, ranges, { start: 1, end: 3 })
    const sameHunkAlone = hunkId(
      Buffer.from('@@ -1,1 +1,1 @@\n-old\n+new\n', 'utf8'),
      lineByteRanges(Buffer.from('@@ -1,1 +1,1 @@\n-old\n+new\n', 'utf8')),
      { start: 0, end: 2 }
    )

    expect(withoutHeader).toBe(sameHunkAlone)
  })
})
