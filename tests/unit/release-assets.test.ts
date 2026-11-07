import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { load } from 'js-yaml'
import {
  channelFor,
  expandMacros,
  expectedAssets,
  releaseProblems,
  type BuilderConfig,
  type ReleaseAsset
} from '../../scripts/release/expected-assets'

/**
 * The real v3.4.0 release, as the GitHub releases API reported it once it had
 * been re-cut and was complete. Twelve assets: five binaries, a `.blockmap`
 * each, and the two update manifests. This is the fixture the check has to
 * call complete, and the sizes are the real ones, so the manifest
 * cross-check below is exercised against data nobody tuned to pass.
 */
const V340_ASSETS: ReleaseAsset[] = [
  { name: 'Arborist-3.4.0-arm64-mac.zip', size: 121818972, state: 'uploaded' },
  { name: 'Arborist-3.4.0-arm64-mac.zip.blockmap', size: 128833, state: 'uploaded' },
  { name: 'arborist-3.4.0-arm64.dmg', size: 122275452, state: 'uploaded' },
  { name: 'arborist-3.4.0-arm64.dmg.blockmap', size: 128998, state: 'uploaded' },
  { name: 'Arborist-3.4.0-mac.zip', size: 130155720, state: 'uploaded' },
  { name: 'Arborist-3.4.0-mac.zip.blockmap', size: 136676, state: 'uploaded' },
  { name: 'arborist-3.4.0-setup.exe', size: 102127360, state: 'uploaded' },
  { name: 'arborist-3.4.0-setup.exe.blockmap', size: 107515, state: 'uploaded' },
  { name: 'arborist-3.4.0-x64.dmg', size: 130556323, state: 'uploaded' },
  { name: 'arborist-3.4.0-x64.dmg.blockmap', size: 136297, state: 'uploaded' },
  { name: 'latest-mac.yml', size: 808, state: 'uploaded' },
  { name: 'latest.yml', size: 345, state: 'uploaded' }
]

/** v3.4.0's own manifests, as electron-builder wrote them. */
const V340_MANIFESTS = [
  {
    name: 'latest-mac.yml',
    version: '3.4.0',
    files: [
      { url: 'Arborist-3.4.0-mac.zip', size: 130155720 },
      { url: 'Arborist-3.4.0-arm64-mac.zip', size: 121818972 },
      { url: 'arborist-3.4.0-x64.dmg', size: 130556323 },
      { url: 'arborist-3.4.0-arm64.dmg', size: 122275452 }
    ]
  },
  {
    name: 'latest.yml',
    version: '3.4.0',
    files: [{ url: 'arborist-3.4.0-setup.exe', size: 102127360 }]
  }
]

/** The project's real config, so the test cannot drift from what ships. */
function realConfig(): BuilderConfig {
  const text = readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')
  return load(text) as BuilderConfig
}

describe('expectedAssets', () => {
  const pkg = { name: 'arborist', version: '3.4.0' }

  it('derives exactly the twelve assets v3.4.0 really carries', () => {
    const expected = expectedAssets(realConfig(), pkg)

    expect([...expected.all].sort()).toEqual(V340_ASSETS.map((asset) => asset.name).sort())
  })

  // Each of these came out differently in the real release, and each for a
  // different reason in electron-builder's expansion rules. Spelled out so a
  // change to one cannot be mistaken for a change to all three.
  it('keeps the arch in a configured pattern and drops it from a default one', () => {
    const { binaries } = expectedAssets(realConfig(), pkg)

    // `dmg.artifactName` is given in the config, so x64 is spelled out.
    expect(binaries).toContain('arborist-3.4.0-x64.dmg')
    // The mac zip has no pattern of its own, and its default leaves the
    // default arch out — along with the dash in front of it.
    expect(binaries).toContain('Arborist-3.4.0-mac.zip')
    expect(binaries).toContain('Arborist-3.4.0-arm64-mac.zip')
    // nsis names no arch at all.
    expect(binaries).toContain('arborist-3.4.0-setup.exe')
  })

  it('names the manifests after the channel the version implies', () => {
    expect(expectedAssets(realConfig(), pkg).manifests).toEqual(['latest-mac.yml', 'latest.yml'])
    expect(
      expectedAssets(realConfig(), { name: 'arborist', version: '3.5.0-rc.1' }).manifests
    ).toEqual(['rc-mac.yml', 'rc.yml'])
  })

  it('refuses to guess at a target it does not model', () => {
    const config = { ...realConfig(), win: { target: [{ target: 'msi', arch: ['x64'] }] } }

    expect(() => expectedAssets(config, pkg)).toThrow(/"msi" target/)
  })

  it('refuses to guess at a macro it cannot expand', () => {
    expect(() =>
      expandMacros('${name}-${channel}.${ext}', {
        name: 'arborist',
        productName: 'Arborist',
        version: '3.4.0',
        arch: 'x64',
        ext: 'dmg'
      })
    ).toThrow(/\$\{channel\} macro/)
  })
})

describe('channelFor', () => {
  it('reads the channel out of a prerelease version', () => {
    expect(channelFor('3.4.0')).toBe('latest')
    expect(channelFor('3.5.0-rc.1')).toBe('rc')
    expect(channelFor('3.5.0-beta.2')).toBe('beta')
  })
})

describe('releaseProblems', () => {
  const pkg = { name: 'arborist', version: '3.4.0' }
  const expected = expectedAssets(realConfig(), pkg)

  function check(assets: ReleaseAsset[], manifests = V340_MANIFESTS): string[] {
    return releaseProblems({ expected, assets, manifests, version: '3.4.0' })
  }

  it('passes the complete release', () => {
    expect(check(V340_ASSETS)).toEqual([])
  })

  // The incident itself: GitHub 500ed on both Apple Silicon artifacts and the
  // Windows installer, and the manifests never got written because the build
  // task died before electron-builder reached them.
  it('catches the v3.4.0 failure', () => {
    const broken = V340_ASSETS.filter(
      (asset) =>
        !asset.name.includes('arm64') &&
        asset.name !== 'arborist-3.4.0-setup.exe' &&
        !asset.name.endsWith('.yml')
    )

    const problems = check(broken, [])

    expect(problems).toContain('Missing asset: Arborist-3.4.0-arm64-mac.zip')
    expect(problems).toContain('Missing asset: arborist-3.4.0-arm64.dmg')
    expect(problems).toContain('Missing asset: arborist-3.4.0-setup.exe')
    expect(problems).toContain('Missing asset: latest-mac.yml')
    expect(problems).toContain('Missing asset: latest.yml')
  })

  it('catches a single missing blockmap', () => {
    const broken = V340_ASSETS.filter((asset) => asset.name !== 'arborist-3.4.0-setup.exe.blockmap')

    expect(check(broken)).toEqual(['Missing asset: arborist-3.4.0-setup.exe.blockmap'])
  })

  it('catches an upload that started and never finished', () => {
    const broken = V340_ASSETS.map((asset) =>
      asset.name === 'arborist-3.4.0-x64.dmg' ? { ...asset, state: 'starter' } : asset
    )

    expect(check(broken)).toEqual([
      'Asset arborist-3.4.0-x64.dmg is in state "starter" rather than "uploaded".'
    ])
  })

  // A re-cut release that kept an older manifest is the shape this catches:
  // every asset present, every state right, and electron-updater refusing
  // the download because the length does not match.
  it('catches a manifest whose sizes disagree with the binaries', () => {
    const stale = [
      { ...V340_MANIFESTS[0], files: [{ url: 'Arborist-3.4.0-mac.zip', size: 999 }] },
      V340_MANIFESTS[1]
    ]

    const problems = check(V340_ASSETS, stale)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/latest-mac\.yml says Arborist-3\.4\.0-mac\.zip is 999 bytes/)
  })

  it('catches a manifest from a different version, and an empty one', () => {
    const wrong = [
      { name: 'latest-mac.yml', version: '3.3.0', files: V340_MANIFESTS[0].files },
      { name: 'latest.yml', version: '3.4.0', files: [] }
    ]

    const problems = check(V340_ASSETS, wrong)

    expect(problems).toContain('latest-mac.yml describes version 3.3.0, but this release is 3.4.0.')
    expect(problems).toContain(
      'latest.yml lists no files, so electron-updater has nothing to download.'
    )
  })

  it('catches a manifest pointing at an asset that is not there', () => {
    const dangling = [
      {
        ...V340_MANIFESTS[0],
        files: [...V340_MANIFESTS[0].files, { url: 'Arborist-3.4.0-universal-mac.zip', size: 1 }]
      },
      V340_MANIFESTS[1]
    ]

    expect(check(V340_ASSETS, dangling)).toEqual([
      'latest-mac.yml points at Arborist-3.4.0-universal-mac.zip, which this release does not carry.'
    ])
  })
})
