import { describe, it, expect, vi } from 'vitest'
import {
  discoverGit,
  knownGitLocations,
  GitLocator,
  type DiscoveryDeps
} from '../../src/main/services/git/git-discovery'

function deps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    platform: 'darwin',
    env: {},
    which: async () => null,
    probe: async () => null,
    ...overrides
  }
}

/** Reports a version only for the paths listed; everything else is not git. */
function probeOnly(...working: string[]): DiscoveryDeps['probe'] {
  return vi.fn(async (path: string) => (working.includes(path) ? '2.43.0' : null))
}

describe('discoverGit', () => {
  it('prefers a settings override that runs', async () => {
    const result = await discoverGit(
      '/custom/git',
      deps({ which: async () => '/usr/bin/git', probe: probeOnly('/custom/git', '/usr/bin/git') })
    )

    expect(result).toMatchObject({ found: true, path: '/custom/git', source: 'settings' })
    expect(result.overrideError).toBeNull()
  })

  it('falls through a broken override and reports it', async () => {
    const result = await discoverGit(
      '/custom/git',
      deps({ which: async () => '/usr/bin/git', probe: probeOnly('/usr/bin/git') })
    )

    expect(result).toMatchObject({ found: true, path: '/usr/bin/git', source: 'path' })
    expect(result.overrideError).toMatch(/not a working git/i)
  })

  it('prefers PATH over the known locations', async () => {
    const result = await discoverGit(
      null,
      deps({
        which: async () => '/opt/custom/git',
        probe: probeOnly('/opt/custom/git', '/usr/bin/git')
      })
    )

    expect(result).toMatchObject({ found: true, path: '/opt/custom/git', source: 'path' })
  })

  it('skips a PATH entry that cannot run and tries the known locations', async () => {
    const probe = probeOnly('/opt/homebrew/bin/git')
    const result = await discoverGit(null, deps({ which: async () => '/usr/bin/git', probe }))

    // /usr/bin/git exists on a Mac with no developer tools but is a stub that
    // fails --version; passing it over is the whole point of probing.
    expect(result).toMatchObject({
      found: true,
      path: '/opt/homebrew/bin/git',
      source: 'known-location'
    })
    expect(probe).toHaveBeenCalledWith('/usr/bin/git')
  })

  it('reports not found when nothing runs', async () => {
    const result = await discoverGit(null, deps())

    expect(result).toEqual({
      found: false,
      path: null,
      version: null,
      source: 'none',
      overrideError: null
    })
  })

  it('returns the probed version', async () => {
    const result = await discoverGit(
      null,
      deps({ which: async () => '/usr/bin/git', probe: async () => '2.51.1' })
    )

    expect(result.version).toBe('2.51.1')
  })
})

describe('knownGitLocations', () => {
  it('lists the Windows install locations from the environment', () => {
    const locations = knownGitLocations('win32', {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LocalAppData: 'C:\\Users\\iso\\AppData\\Local',
      UserProfile: 'C:\\Users\\iso'
    })

    expect(locations).toEqual([
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      'C:\\Users\\iso\\AppData\\Local\\Programs\\Git\\cmd\\git.exe',
      'C:\\Users\\iso\\scoop\\shims\\git.exe',
      'C:\\ProgramData\\scoop\\shims\\git.exe',
      'C:\\ProgramData\\chocolatey\\bin\\git.exe',
      'C:\\Users\\iso\\PortableGit\\cmd\\git.exe',
      'C:\\PortableGit\\cmd\\git.exe',
      'C:\\Program Files\\Git\\bin\\git.exe'
    ])
  })

  it('honours a relocated ProgramData', () => {
    const locations = knownGitLocations('win32', { ProgramData: 'D:\\ProgramData' })
    expect(locations).toContain('D:\\ProgramData\\scoop\\shims\\git.exe')
    expect(locations).toContain('D:\\ProgramData\\chocolatey\\bin\\git.exe')
  })

  it('omits Windows locations whose environment variable is unset', () => {
    const locations = knownGitLocations('win32', {})
    expect(locations.every((path) => path.length > 0)).toBe(true)
    // The per-user scoop shim is the one under UserProfile; the machine-wide
    // one under ProgramData has a usable default and stays.
    expect(locations.some((path) => path.includes('\\scoop\\'))).toBe(true)
    expect(locations.some((path) => path.includes('PortableGit\\cmd'))).toBe(true)
    expect(locations.some((path) => path.startsWith('undefined'))).toBe(false)
  })

  it('lists the macOS locations with /usr/bin first', () => {
    expect(knownGitLocations('darwin', {})).toEqual([
      '/usr/bin/git',
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
      '/opt/local/bin/git',
      '/Applications/Xcode.app/Contents/Developer/usr/bin/git'
    ])
  })
})

describe('GitLocator', () => {
  it('discovers once and serves the cached result', async () => {
    const which = vi.fn(async () => '/usr/bin/git')
    const locator = new GitLocator(deps({ which, probe: probeOnly('/usr/bin/git') }))

    await locator.discover()
    await locator.discover()

    expect(which).toHaveBeenCalledTimes(1)
  })

  it('re-runs discovery when the override changes', async () => {
    const locator = new GitLocator(deps({ probe: probeOnly('/a/git', '/b/git') }), '/a/git')

    expect((await locator.discover()).path).toBe('/a/git')
    locator.setOverride('/b/git')
    expect((await locator.discover()).path).toBe('/b/git')
  })
})
