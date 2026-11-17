import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { LOCAL_DIR, parseScreenshotArgs, resolveOutDir } from '../../scripts/screenshots/output'

describe('resolveOutDir', () => {
  it('writes every capture to the local, ignored directory', () => {
    expect(resolveOutDir()).toBe(resolve(LOCAL_DIR))
  })
  it('lets --out override it', () => {
    expect(resolveOutDir('/tmp/x')).toBe(resolve('/tmp/x'))
  })
})

describe('parseScreenshotArgs (#155)', () => {
  it('runs every scenario and records the manifest by default', () => {
    expect(parseScreenshotArgs([])).toEqual({ outDir: undefined, names: [], recordManifest: true })
  })

  it('takes scenario names, still recording the manifest', () => {
    expect(parseScreenshotArgs(['shell', 'fetch'])).toEqual({
      outDir: undefined,
      names: ['shell', 'fetch'],
      recordManifest: true
    })
  })

  it('leaves the committed manifest alone under --out, wherever it appears', () => {
    expect(parseScreenshotArgs(['--out', '/tmp/x'])).toEqual({
      outDir: '/tmp/x',
      names: [],
      recordManifest: false
    })
    expect(parseScreenshotArgs(['shell', '--out', '/tmp/x', 'fetch'])).toEqual({
      outDir: '/tmp/x',
      names: ['shell', 'fetch'],
      recordManifest: false
    })
  })

  it('refuses --out without a directory', () => {
    expect(() => parseScreenshotArgs(['--out'])).toThrow('--out needs a directory')
    expect(() => parseScreenshotArgs(['--out', '--other'])).toThrow('--out needs a directory')
  })

  it('refuses an unknown option rather than treating it as a scenario name', () => {
    expect(() => parseScreenshotArgs(['--no-manifest'])).toThrow('Unknown option "--no-manifest"')
  })
})
