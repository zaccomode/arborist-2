import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * The vendored scripts are exactly the bytes their README table records
 * (#154), so an edit to one — by hand, by a formatter, or by a bump that
 * forgot the table — fails here rather than slipping through review.
 */
describe('scripts/vendor', () => {
  it('holds each file with the SHA-256 its README records', async () => {
    const readme = await readFile('scripts/vendor/README.md', 'utf8')
    const rows = [...readme.matchAll(/^\| `([^`]+)`\s*\|.*\| `([0-9a-f]{64})` \|$/gm)]
    expect(rows.map(([, file]) => file)).toContain('cdn.mjs')

    for (const [, file, recorded] of rows) {
      const actual = createHash('sha256')
        .update(await readFile(`scripts/vendor/${file}`))
        .digest('hex')
      expect(actual, file).toBe(recorded)
    }
  })
})
