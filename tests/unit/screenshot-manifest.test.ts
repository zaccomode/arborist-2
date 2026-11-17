import { describe, expect, it } from 'vitest'
import {
  captureFileName,
  cdnUrl,
  mergeManifest,
  parseManifest,
  KEY_SCREENS_END,
  KEY_SCREENS_START,
  recordCapture,
  renderKeyScreens,
  replaceKeyScreens,
  serializeManifest,
  sha256Hex,
  type Manifest
} from '../../scripts/screenshots/manifest'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

describe('sha256Hex', () => {
  it('hashes the bytes as given, matching sha256sum', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})

describe('captureFileName', () => {
  it('names a step-less capture by scenario and theme', () => {
    expect(captureFileName('shell', '', 'dark')).toBe('shell-dark.png')
  })
  it('puts the step between them', () => {
    expect(captureFileName('create-worktree', 'after', 'light')).toBe(
      'create-worktree-after-light.png'
    )
  })
})

describe('cdnUrl', () => {
  it('addresses an image by its hash alone', () => {
    expect(cdnUrl(A)).toBe(`https://cdn.isaacshea.com/i/${A}.png`)
  })
})

describe('recordCapture', () => {
  it('nests by scenario, step and theme', () => {
    const manifest: Manifest = {}
    recordCapture(manifest, { scenario: 'shell', step: '', theme: 'dark', sha256: A })
    recordCapture(manifest, { scenario: 'shell', step: '', theme: 'light', sha256: B })
    recordCapture(manifest, { scenario: 'flow', step: 'after', theme: 'dark', sha256: C })
    expect(manifest).toEqual({
      shell: { '': { dark: A, light: B } },
      flow: { after: { dark: C } }
    })
  })
})

describe('mergeManifest', () => {
  const previous: Manifest = {
    shell: { '': { dark: A, light: A } },
    flow: { before: { dark: A }, removed: { dark: A } },
    deleted: { '': { dark: A } }
  }

  it("replaces a scenario that ran wholesale, dropping steps it didn't capture", () => {
    const merged = mergeManifest(previous, { flow: { before: { dark: B } } }, ['shell', 'flow'])
    expect(merged.flow).toEqual({ before: { dark: B } })
  })
  it("keeps a scenario that didn't run", () => {
    const merged = mergeManifest(previous, { flow: { before: { dark: B } } }, ['shell', 'flow'])
    expect(merged.shell).toEqual(previous.shell)
  })
  it('drops a scenario that no longer exists', () => {
    expect(mergeManifest(previous, {}, ['shell', 'flow'])).not.toHaveProperty('deleted')
  })
  it('adds a new scenario', () => {
    const merged = mergeManifest({}, { fresh: { '': { dark: C } } }, ['fresh'])
    expect(merged).toEqual({ fresh: { '': { dark: C } } })
  })
})

describe('serializeManifest', () => {
  it('sorts keys at every level, whatever order they were captured in', () => {
    const captured: Manifest = {
      zeta: { '': { light: B, dark: A } },
      alpha: { second: { dark: C }, first: { light: A, dark: B } }
    }
    const text = serializeManifest(captured)
    expect(text).toBe(
      serializeManifest({
        alpha: { first: { dark: B, light: A }, second: { dark: C } },
        zeta: { '': { dark: A, light: B } }
      })
    )
    expect(Object.keys(JSON.parse(text))).toEqual(['alpha', 'zeta'])
    expect(Object.keys(JSON.parse(text).alpha)).toEqual(['first', 'second'])
    expect(Object.keys(JSON.parse(text).alpha.first)).toEqual(['dark', 'light'])
    expect(text.endsWith('}\n')).toBe(true)
  })
  it('round-trips through parseManifest', () => {
    const manifest: Manifest = { shell: { '': { dark: A, light: B } } }
    expect(parseManifest(serializeManifest(manifest))).toEqual(manifest)
  })
})

describe('parseManifest', () => {
  it('rejects a hash that is not a SHA-256', () => {
    expect(() => parseManifest(JSON.stringify({ shell: { '': { dark: 'abc' } } }))).toThrow(
      /shell-dark\.png/
    )
  })
  it('rejects the wrong shape', () => {
    expect(() => parseManifest('[]')).toThrow()
    expect(() => parseManifest(JSON.stringify({ shell: { '': A } }))).toThrow()
  })
})

describe('renderKeyScreens', () => {
  const manifest: Manifest = {
    shell: { '': { dark: A, light: B } },
    flow: { before: { dark: A, light: A }, after: { dark: C, light: C } },
    other: { '': { dark: C, light: C } }
  }

  it('renders each step of each key scenario with CDN images, in the order given', () => {
    const table = renderKeyScreens(
      manifest,
      [
        { name: 'shell', key: 'The shell.' },
        { name: 'flow', key: 'A flow.' }
      ],
      ['dark', 'light']
    )
    expect(table.split('\n')).toEqual([
      '| Capture | What it shows | Dark | Light |',
      '| --- | --- | --- | --- |',
      `| \`shell\` | The shell. | ![shell, dark](${cdnUrl(A)}) | ![shell, light](${cdnUrl(B)}) |`,
      `| \`flow\` · \`after\` | A flow. | ![flow, after, dark](${cdnUrl(C)}) | ![flow, after, light](${cdnUrl(C)}) |`,
      `| \`flow\` · \`before\` |  | ![flow, before, dark](${cdnUrl(A)}) | ![flow, before, light](${cdnUrl(A)}) |`
    ])
  })
  it('skips a key scenario that has no captures yet', () => {
    const table = renderKeyScreens(manifest, [{ name: 'missing', key: 'x' }], ['dark'])
    expect(table.split('\n')).toHaveLength(2)
  })
  it('escapes a pipe in a caption, which would otherwise split the cell', () => {
    const table = renderKeyScreens(manifest, [{ name: 'shell', key: 'a | b' }], ['dark'])
    expect(table).toContain('a \\| b')
  })
})

describe('replaceKeyScreens', () => {
  it('swaps only what is between the markers', () => {
    const readme = `# Title\n\n${KEY_SCREENS_START}\n\nold\n\n${KEY_SCREENS_END}\n\nFooter\n`
    expect(replaceKeyScreens(readme, 'new')).toBe(
      `# Title\n\n${KEY_SCREENS_START}\n\nnew\n\n${KEY_SCREENS_END}\n\nFooter\n`
    )
  })
  it('fails loudly when the markers are missing', () => {
    expect(() => replaceKeyScreens('# Title\n', 'new')).toThrow(/markers/)
  })
})
