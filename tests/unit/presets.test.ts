import { describe, it, expect } from 'vitest'
import { builtInPresetId, githubUrlFromRemote, resolvePresets } from '@shared/presets'
import type { BuiltInPreset } from '@shared/presets'
import type { Preset, PresetConfig } from '@shared/persisted'

const builtIns: BuiltInPreset[] = [
  {
    builtinId: 'reveal',
    name: 'Finder',
    icon: 'Folder',
    platforms: [],
    enabledByDefault: true,
    sortOrder: 0
  },
  {
    builtinId: 'terminal',
    name: 'Terminal',
    icon: 'Terminal',
    platforms: ['darwin', 'win32'],
    enabledByDefault: true,
    sortOrder: 1
  },
  {
    builtinId: 'xcode',
    name: 'Xcode',
    icon: 'Hammer',
    platforms: ['darwin'],
    enabledByDefault: false,
    sortOrder: 2
  }
]

const everythingAvailable = ['reveal', 'terminal', 'xcode']

const config: PresetConfig = { disabledIds: [], overrides: {}, order: [] }

function custom(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'custom-1',
    name: 'Run tests',
    icon: 'TestTube',
    command: { type: 'shell', script: 'npm test' },
    sortOrder: 0,
    enabledByDefault: true,
    projectId: null,
    ...overrides
  }
}

function resolve(input: Partial<Parameters<typeof resolvePresets>[0]> = {}): string[] {
  return resolvePresets({
    builtIns,
    availableBuiltInIds: everythingAvailable,
    presets: [],
    config,
    projectId: null,
    platform: 'darwin',
    ...input
  }).map((preset) => preset.id)
}

describe('resolvePresets', () => {
  it('offers the enabled built-ins in order', () => {
    expect(resolve()).toEqual([builtInPresetId('reveal'), builtInPresetId('terminal')])
  })

  it('leaves out a built-in that is off by default until it is switched on', () => {
    expect(resolve()).not.toContain(builtInPresetId('xcode'))
    expect(resolve({ config: { ...config, overrides: {} } })).not.toContain(
      builtInPresetId('xcode')
    )
  })

  it('hides built-ins the platform does not have', () => {
    expect(resolve({ platform: 'linux' })).toEqual([builtInPresetId('reveal')])
  })

  it('hides a built-in whose target was not found on this machine', () => {
    expect(resolve({ availableBuiltInIds: ['reveal'] })).toEqual([builtInPresetId('reveal')])
  })

  it('respects an app-level switch-off', () => {
    const disabled = { ...config, disabledIds: [builtInPresetId('terminal')] }
    expect(resolve({ config: disabled })).toEqual([builtInPresetId('reveal')])
  })

  it('lets a project override win over the app-level setting, both ways', () => {
    const overrides = {
      p1: {
        [builtInPresetId('terminal')]: 'off' as const,
        [builtInPresetId('xcode')]: 'on' as const
      }
    }

    expect(resolve({ config: { ...config, overrides }, projectId: 'p1' })).toEqual([
      builtInPresetId('reveal'),
      builtInPresetId('xcode')
    ])
    // ...and only for that project.
    expect(resolve({ config: { ...config, overrides }, projectId: 'p2' })).toEqual([
      builtInPresetId('reveal'),
      builtInPresetId('terminal')
    ])
  })

  it('turns a preset back on for one project that is off for the app', () => {
    const disabled = {
      ...config,
      disabledIds: [builtInPresetId('terminal')],
      overrides: { p1: { [builtInPresetId('terminal')]: 'on' as const } }
    }

    expect(resolve({ config: disabled, projectId: 'p1' })).toContain(builtInPresetId('terminal'))
  })

  it('appends app-level custom presets after the built-ins', () => {
    expect(resolve({ presets: [custom()] })).toEqual([
      builtInPresetId('reveal'),
      builtInPresetId('terminal'),
      'custom-1'
    ])
  })

  it('appends a project-specific preset last, and only for its project', () => {
    const presets = [custom(), custom({ id: 'project-1', projectId: 'p1', name: 'Deploy' })]

    expect(resolve({ presets, projectId: 'p1' })).toEqual([
      builtInPresetId('reveal'),
      builtInPresetId('terminal'),
      'custom-1',
      'project-1'
    ])
    expect(resolve({ presets, projectId: 'p2' })).not.toContain('project-1')
  })

  it('follows an explicit order, keeping anything unlisted behind it', () => {
    const ordered = {
      ...config,
      order: ['custom-1', builtInPresetId('terminal')]
    }

    expect(resolve({ presets: [custom()], config: ordered })).toEqual([
      'custom-1',
      builtInPresetId('terminal'),
      builtInPresetId('reveal')
    ])
  })
})

describe('githubUrlFromRemote', () => {
  it.each([
    ['git@github.com:zaccomode/arborist-2.git', 'https://github.com/zaccomode/arborist-2'],
    ['ssh://git@github.com/zaccomode/arborist-2.git', 'https://github.com/zaccomode/arborist-2'],
    ['https://github.com/zaccomode/arborist-2.git', 'https://github.com/zaccomode/arborist-2'],
    ['https://github.com/zaccomode/arborist-2', 'https://github.com/zaccomode/arborist-2'],
    ['https://iso@github.com/zaccomode/arborist-2.git', 'https://github.com/zaccomode/arborist-2']
  ])('normalises %s', (remote, expected) => {
    expect(githubUrlFromRemote(`${remote}\n`)).toBe(expected)
  })

  it('returns null for a remote that is not GitHub', () => {
    expect(githubUrlFromRemote('git@gitlab.com:iso/thing.git')).toBeNull()
    expect(githubUrlFromRemote('/srv/git/thing.git')).toBeNull()
    expect(githubUrlFromRemote('')).toBeNull()
  })
})
