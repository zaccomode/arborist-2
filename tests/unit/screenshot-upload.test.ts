import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import {
  assertCliPinned,
  CDN_CLI,
  CDN_CLI_SHA256,
  cdnEnv,
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
    // The vendored CLI's own rule, read from the CLI itself so a bump that
    // tightens it fails here.
    const cli = readFileSync(CDN_CLI, 'utf8')
    const pattern = cli.match(/^var BUCKET_SEGMENT_PATTERN = \/(.+)\/;$/m)?.[1]
    const depth = cli.match(/^var MAX_BUCKET_DEPTH = (\d+);$/m)?.[1]
    expect(pattern, 'BUCKET_SEGMENT_PATTERN in cdn.mjs').toBeDefined()
    expect(depth, 'MAX_BUCKET_DEPTH in cdn.mjs').toBeDefined()
    const segment = new RegExp(pattern!)
    const segments = prBucket(1234567).split('/')
    expect(segments.length).toBeLessThanOrEqual(Number(depth))
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

  it('rejects --pr=<n>, which it does not parse, rather than taking it as a file', () => {
    expect(() => parseUploadArgs(['--pr=42', 'a.png'])).toThrow(/--pr=42/)
  })

  it('rejects --pr given twice', () => {
    expect(() => parseUploadArgs(['--pr', '42', '--pr', '43', 'a.png'])).toThrow(/twice/)
  })

  it.each(['-h', '-x', '-'])(
    'rejects a single-dash argument rather than passing it to the CLI as a file: %s',
    (arg) => {
      // The CLI treats `-h` anywhere as a request for help and exits 0, so
      // passing it through would upload nothing and report success.
      expect(() => parseUploadArgs(['--pr', '42', 'a.png', arg])).toThrow(arg)
    }
  )

  it('takes a dash-named file written as a path', () => {
    expect(parseUploadArgs(['--pr', '42', './-h']).files).toEqual(['./-h'])
  })
})

describe('the CLI pin', () => {
  it('matches the vendored file and the vendor README', () => {
    const actual = createHash('sha256').update(readFileSync(CDN_CLI)).digest('hex')
    expect(actual).toBe(CDN_CLI_SHA256)
    const readme = readFileSync('scripts/vendor/README.md', 'utf8')
    expect(readme).toMatch(new RegExp(`^\\| \`cdn\\.mjs\`.*\\| \`${CDN_CLI_SHA256}\` \\|$`, 'm'))
  })

  it('refuses any other hash', () => {
    expect(() => assertCliPinned(CDN_CLI_SHA256)).not.toThrow()
    expect(() => assertCliPinned('0'.repeat(64))).toThrow(/Refusing to run/)
  })
})

describe('cdnEnv', () => {
  it('drops CDN_API, so the token cannot be sent to another host, and keeps the rest', () => {
    expect(cdnEnv({ CDN_API: 'https://evil.example', CDN_TOKEN: 't', PATH: '/bin' })).toEqual({
      CDN_TOKEN: 't',
      PATH: '/bin'
    })
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
