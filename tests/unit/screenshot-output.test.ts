import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { COMMITTED_DIR, LOCAL_DIR, resolveOutDir } from '../../scripts/screenshots/output'

describe('resolveOutDir', () => {
  it('writes committed scenarios into the tracked directory', () => {
    expect(resolveOutDir({ committed: true })).toBe(resolve(COMMITTED_DIR))
  })
  it('writes every other scenario to the local, ignored directory', () => {
    expect(resolveOutDir({})).toBe(resolve(LOCAL_DIR))
    expect(resolveOutDir({ committed: false })).toBe(resolve(LOCAL_DIR))
  })
  it('lets --out override both', () => {
    expect(resolveOutDir({ committed: true }, '/tmp/x')).toBe(resolve('/tmp/x'))
    expect(resolveOutDir({}, '/tmp/x')).toBe(resolve('/tmp/x'))
  })
})
