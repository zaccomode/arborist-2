import { describe, it, expect } from 'vitest'
import {
  builtInPresetId,
  filterForTarget,
  githubUrlFromRemote,
  resolveConflictEditorPreset,
  resolvePresets
} from '@shared/presets'
import type { BuiltInPreset, ResolvedPreset } from '@shared/presets'
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
    builtinId: 'extra',
    name: 'Extra Tool',
    icon: 'Hammer',
    platforms: ['darwin'],
    enabledByDefault: false,
    sortOrder: 2
  }
]

const config: PresetConfig = { appOverrides: {}, overrides: {}, order: [] }

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
    expect(resolve()).not.toContain(builtInPresetId('extra'))
    expect(resolve({ config: { ...config, overrides: {} } })).not.toContain(
      builtInPresetId('extra')
    )
  })

  it('hides built-ins the platform does not have', () => {
    expect(resolve({ platform: 'linux' })).toEqual([builtInPresetId('reveal')])
  })

  it('offers a built-in whether or not its app is installed', () => {
    // Nothing probes the machine any more: the switch is the user's answer,
    // and a preset that cannot launch says so when it is pressed.
    expect(resolve()).toContain(builtInPresetId('terminal'))
  })

  it('respects an app-level switch-off', () => {
    const off = { ...config, appOverrides: { [builtInPresetId('terminal')]: 'off' as const } }
    expect(resolve({ config: off })).toEqual([builtInPresetId('reveal')])
  })

  it('switches on a built-in that is off by default', () => {
    // A preset defaulting to off means the app-level state used to be a
    // list of ids switched *off* — so switching one on had nothing to record
    // and it read back off, which is exactly how it behaved in the app.
    const on = { ...config, appOverrides: { [builtInPresetId('extra')]: 'on' as const } }
    expect(resolve({ config: on })).toContain(builtInPresetId('extra'))
  })

  it('lets a project override win over the app-level setting, both ways', () => {
    const overrides = {
      p1: {
        [builtInPresetId('terminal')]: 'off' as const,
        [builtInPresetId('extra')]: 'on' as const
      }
    }

    expect(resolve({ config: { ...config, overrides }, projectId: 'p1' })).toEqual([
      builtInPresetId('reveal'),
      builtInPresetId('extra')
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
      appOverrides: { [builtInPresetId('terminal')]: 'off' as const },
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

function resolved(overrides: Partial<ResolvedPreset> = {}): ResolvedPreset {
  return {
    id: 'x',
    name: 'X',
    icon: 'Folder',
    builtinId: null,
    projectId: null,
    ...overrides
  }
}

describe('filterForTarget', () => {
  const reveal = resolved({ id: builtInPresetId('reveal'), name: 'Finder', builtinId: 'reveal' })
  const terminal = resolved({
    id: builtInPresetId('terminal'),
    name: 'Terminal',
    builtinId: 'terminal'
  })
  const vscode = resolved({ id: builtInPresetId('vscode'), name: 'VS Code', builtinId: 'vscode' })
  const github = resolved({ id: builtInPresetId('github'), name: 'GitHub', builtinId: 'github' })
  const custom = resolved({ id: 'custom-1', name: 'Run tests', builtinId: null })
  const list = [reveal, terminal, vscode, github, custom]

  it('leaves the list untouched for a worktree target', () => {
    expect(filterForTarget(list, 'worktree')).toEqual(list)
  })

  it('keeps only file-capable built-ins, and every custom preset, for a file target', () => {
    expect(filterForTarget(list, 'file')).toEqual([reveal, vscode, custom])
  })

  it('drops terminal and github entirely for a file target', () => {
    const ids = filterForTarget(list, 'file').map((preset) => preset.id)
    expect(ids).not.toContain(terminal.id)
    expect(ids).not.toContain(github.id)
  })
})

describe('resolveConflictEditorPreset', () => {
  const reveal = resolved({ id: builtInPresetId('reveal'), name: 'Finder', builtinId: 'reveal' })
  const vscode = resolved({ id: builtInPresetId('vscode'), name: 'VS Code', builtinId: 'vscode' })
  const custom = resolved({ id: 'custom-1', name: 'Sublime', builtinId: null })

  it('picks the first editor-like preset on a stock install, skipping reveal', () => {
    expect(resolveConflictEditorPreset(null, [reveal, vscode])).toEqual(vscode)
  })

  it('honours an explicit configured id, even if it is reveal', () => {
    expect(resolveConflictEditorPreset(reveal.id, [reveal, vscode])).toEqual(reveal)
  })

  it('falls back to auto-resolution when the configured id is no longer offered', () => {
    expect(resolveConflictEditorPreset('gone', [reveal, vscode])).toEqual(vscode)
  })

  it('falls back to reveal when nothing else is file-capable', () => {
    expect(resolveConflictEditorPreset(null, [reveal])).toEqual(reveal)
  })

  it('returns null when there is nothing file-capable at all', () => {
    expect(resolveConflictEditorPreset(null, [])).toBeNull()
  })

  it('prefers a custom preset over reveal too', () => {
    expect(resolveConflictEditorPreset(null, [reveal, custom])).toEqual(custom)
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
