import { describe, expect, it } from 'vitest'
import {
  cdnUploadArgs,
  parseUploadArgs,
  prBucket,
  SCREENSHOTS_BUCKET
} from '../../scripts/screenshots/upload'

describe('prBucket', () => {
  it('nests each PR in a bucket of its own under the screenshots bucket', () => {
    expect(prBucket(160)).toBe('arborist-2/screenshots/pr-160')
    expect(prBucket(160).startsWith(`${SCREENSHOTS_BUCKET}/`)).toBe(true)
  })

  it('makes a path the image host accepts', () => {
    // The vendored CLI's own rule: lowercase segments of [a-z0-9-], each
    // starting with a letter or digit, at most 8 deep.
    const segment = /^[a-z0-9][a-z0-9-]{0,63}$/
    const segments = prBucket(1234567).split('/')
    expect(segments.length).toBeLessThanOrEqual(8)
    for (const s of segments) expect(s).toMatch(segment)
  })
})

describe('parseUploadArgs', () => {
  it('takes the PR and the files, in any order', () => {
    expect(parseUploadArgs(['a.png', '--pr', '42', 'b.png'])).toEqual({
      pr: 42,
      files: ['a.png', 'b.png']
    })
  })

  it('needs a PR, so no capture lands outside a PR bucket', () => {
    expect(() => parseUploadArgs(['a.png'])).toThrow(/PR/)
  })

  it.each([['a.png', '--pr'], ...['abc', '0', '-1', '1.5'].map((pr) => ['a.png', '--pr', pr])])(
    'rejects a --pr that is missing its value or is not a PR number: %j',
    (...argv) => {
      expect(() => parseUploadArgs(argv)).toThrow(/--pr/)
    }
  )

  it('needs at least one file', () => {
    expect(() => parseUploadArgs(['--pr', '42'])).toThrow(/at least one/)
  })

  it('rejects options it does not know, rather than passing a bucket through', () => {
    expect(() => parseUploadArgs(['--pr', '42', '--bucket', 'x', 'a.png'])).toThrow(/--bucket/)
  })
})

describe('cdnUploadArgs', () => {
  it("uploads into the PR's bucket, creating it on first use, and records the PR", () => {
    expect(cdnUploadArgs({ pr: 42, files: ['a.png', 'b.png'] })).toEqual([
      'upload',
      'a.png',
      'b.png',
      '--bucket',
      'arborist-2/screenshots/pr-42',
      '--create',
      '--repo',
      'zaccomode/arborist-2',
      '--pr',
      '42'
    ])
  })
})
