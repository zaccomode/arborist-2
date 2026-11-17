import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { LOCAL_DIR, resolveOutDir } from '../../scripts/screenshots/output'

describe('resolveOutDir', () => {
  it('writes every capture to the local, ignored directory', () => {
    expect(resolveOutDir()).toBe(resolve(LOCAL_DIR))
  })
  it('lets --out override it', () => {
    expect(resolveOutDir('/tmp/x')).toBe(resolve('/tmp/x'))
  })
})
