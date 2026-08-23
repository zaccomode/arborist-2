import { execFile, spawn } from 'child_process'
import { promises as fs } from 'fs'
import { shell } from 'electron'
import { AppError } from '../../shared/errors'
import type { Preset } from '../../shared/persisted'
import {
  builtInPresetId,
  enabledAtAppLevel,
  githubUrlFromRemote,
  resolvePresets,
  type BuiltInPreset,
  type PresetCatalogue,
  type PresetRunResult,
  type ResolvedPreset
} from '../../shared/presets'
import { substitute, type SubstitutionValues } from '../../shared/substitution'
import type { Store } from './persistence/store'
import type { GitRunner } from './git/git-runner'
import { which } from './system/which'

/**
 * The built-ins. They store no paths: each one resolves its target at run
 * time, so a settings file copied to another machine still opens things.
 */
export const BUILT_IN_PRESETS: readonly BuiltInPreset[] = [
  {
    builtinId: 'reveal',
    name: process.platform === 'win32' ? 'Explorer' : 'Finder',
    icon: 'Folder',
    platforms: [],
    enabledByDefault: true,
    sortOrder: 0
  },
  {
    builtinId: 'terminal',
    name: 'Terminal',
    icon: 'SquareTerminal',
    platforms: ['darwin', 'win32'],
    enabledByDefault: true,
    sortOrder: 1
  },
  {
    builtinId: 'vscode',
    name: 'VS Code',
    icon: 'Code',
    platforms: [],
    enabledByDefault: true,
    sortOrder: 2
  },
  {
    builtinId: 'github',
    name: 'GitHub',
    icon: 'Globe',
    platforms: [],
    enabledByDefault: true,
    sortOrder: 3
  }
]

export interface PresetContext extends SubstitutionValues {
  projectId: string | null
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Runs a command detached, so closing Arborist doesn't take the editor with
 * it, but waits long enough to know the process actually started. Nothing
 * pre-checks that a target is installed any more, so "the binary isn't there"
 * has to come back as an error rather than as nothing happening.
 */
function launchDetached(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', cwd, windowsHide: false })
    child.once('error', (error) =>
      reject(new AppError(`Could not run ${command}: ${error.message}`, 'preset-launch-failed'))
    )
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/**
 * macOS app launches go through `open`, which returns as soon as
 * LaunchServices has taken the request — so its exit code arrives promptly
 * and says whether the app was there at all.
 */
function openApp(app: string, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', app, path], (error, _stdout, stderr) => {
      if (error) {
        reject(new AppError(stderr.trim() || `Could not open ${app}.`, 'preset-launch-failed'))
      } else {
        resolve()
      }
    })
  })
}

/** Starts a shell preset's command as a run the console can attach to. */
export type ShellRunner = (script: string, cwd: string, values: SubstitutionValues) => string

export class PresetService {
  #store: Store
  #git: GitRunner
  #runShell: ShellRunner

  constructor(store: Store, git: GitRunner, runShell: ShellRunner) {
    this.#store = store
    this.#git = git
    this.#runShell = runShell
  }

  async list(_repoPath: string | null, projectId: string | null): Promise<ResolvedPreset[]> {
    return resolvePresets({
      builtIns: BUILT_IN_PRESETS,
      presets: this.#store.data.presets,
      config: this.#store.data.presetConfig,
      projectId,
      platform: process.platform
    })
  }

  /** Every preset the settings UI can show for this platform. */
  async catalogue(): Promise<PresetCatalogue> {
    const { presets, presetConfig } = this.#store.data

    return {
      builtIns: BUILT_IN_PRESETS.filter(
        (preset) => preset.platforms.length === 0 || preset.platforms.includes(process.platform)
      ).map((preset) => ({
        ...preset,
        id: builtInPresetId(preset.builtinId),
        enabled: enabledAtAppLevel(
          builtInPresetId(preset.builtinId),
          preset.enabledByDefault,
          presetConfig
        )
      })),
      presets: [...presets],
      config: presetConfig
    }
  }

  /**
   * Records the switch, both ways. Recording only the offs meant a preset that
   * defaults to off could be switched on and read back off.
   */
  async setEnabled(presetId: string, enabled: boolean): Promise<void> {
    await this.#store.update((data) => {
      data.presetConfig.appOverrides = {
        ...data.presetConfig.appOverrides,
        [presetId]: enabled ? 'on' : 'off'
      }
    })
  }

  /** Null clears the override, putting the preset back on inherit. */
  async setOverride(
    projectId: string,
    presetId: string,
    override: 'on' | 'off' | null
  ): Promise<void> {
    await this.#store.update((data) => {
      const overrides = { ...(data.presetConfig.overrides[projectId] ?? {}) }
      if (override) overrides[presetId] = override
      else delete overrides[presetId]
      data.presetConfig.overrides[projectId] = overrides
    })
  }

  async save(preset: Preset): Promise<void> {
    await this.#store.update((data) => {
      const index = data.presets.findIndex((entry) => entry.id === preset.id)
      if (index === -1) data.presets.push(preset)
      else data.presets[index] = preset
    })
  }

  async remove(presetId: string): Promise<void> {
    await this.#store.update((data) => {
      data.presets = data.presets.filter((preset) => preset.id !== presetId)
      data.presetConfig.order = data.presetConfig.order.filter((id) => id !== presetId)
    })
  }

  async reorder(orderedIds: string[]): Promise<void> {
    await this.#store.update((data) => {
      data.presetConfig.order = orderedIds
    })
  }

  async run(presetId: string, context: PresetContext): Promise<PresetRunResult> {
    const builtIn = BUILT_IN_PRESETS.find(
      (preset) => builtInPresetId(preset.builtinId) === presetId
    )
    if (builtIn) {
      await this.#runBuiltIn(builtIn.builtinId, context)
      return { kind: 'launched' }
    }

    const custom = this.#store.data.presets.find((preset) => preset.id === presetId)
    if (!custom) throw new AppError(`No preset with id ${presetId}.`, 'preset-not-found')
    return this.#runCustom(custom, context)
  }

  async #runBuiltIn(builtinId: string, context: PresetContext): Promise<void> {
    switch (builtinId) {
      case 'reveal': {
        const error = await shell.openPath(context.path)
        if (error) throw new AppError(error, 'preset-launch-failed')
        return
      }
      case 'terminal':
        return this.#openTerminal(context.path)
      case 'vscode': {
        const command = await this.#vsCodeCommand()
        if (!command) throw new AppError('VS Code was not found.', 'preset-launch-failed')
        return launchDetached(command.command, [...command.args, context.path])
      }
      case 'github': {
        const base = await this.#githubUrl(context.repoPath)
        if (!base) throw new AppError('This project has no GitHub remote.', 'preset-launch-failed')
        const branch = context.branch ?? context.commitHash ?? 'HEAD'
        await shell.openExternal(`${base}/tree/${encodeURIComponent(branch)}`)
        return
      }
      default:
        throw new AppError(`Unknown built-in preset ${builtinId}.`, 'preset-not-found')
    }
  }

  async #runCustom(preset: Preset, context: PresetContext): Promise<PresetRunResult> {
    switch (preset.command.type) {
      case 'app': {
        // Values reach the app as argv entries, so nothing parses them and
        // nothing needs escaping.
        const target = substitute(preset.command.app, context, 'raw')
        if (process.platform === 'darwin' && target.endsWith('.app')) {
          await openApp(target, context.path)
        } else {
          await launchDetached(target, [context.path])
        }
        return { kind: 'launched' }
      }
      case 'url': {
        const url = substitute(preset.command.url, context, 'url')
        // Only http(s): a preset should not be a way to hand an arbitrary
        // scheme to the operating system.
        if (!/^https?:\/\//i.test(url)) {
          throw new AppError(`${url} is not an http(s) URL.`, 'preset-launch-failed')
        }
        await shell.openExternal(url)
        return { kind: 'launched' }
      }
      case 'shell': {
        // Through the automation runner rather than a detached process, so
        // its output and its exit code have somewhere to go. A command that
        // fails silently is worse than one that fails.
        const runId = this.#runShell(preset.command.script, context.path, context)
        return { kind: 'console', runId, presetName: preset.name }
      }
    }
  }

  async #openTerminal(path: string): Promise<void> {
    if (process.platform === 'darwin') return openApp('Terminal', path)

    // Windows Terminal is not on every machine, and the fallback is the
    // flakiest launch in the app — which is exactly why custom shell presets
    // exist as an escape hatch.
    const wt = await which('wt').catch(() => null)
    if (wt) return launchDetached('wt', ['-d', path])
    return launchDetached('powershell', [
      '-NoExit',
      '-Command',
      `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'`
    ])
  }

  async #vsCodeCommand(): Promise<{ command: string; args: string[] } | null> {
    const onPath = await which('code')
    if (onPath) return { command: onPath, args: [] }

    if (process.platform === 'darwin') {
      if (await pathExists('/Applications/Visual Studio Code.app')) {
        return { command: 'open', args: ['-a', '/Applications/Visual Studio Code.app'] }
      }
    }
    if (process.platform === 'win32') {
      const local = process.env['LocalAppData']
      const exe = local ? `${local}\\Programs\\Microsoft VS Code\\Code.exe` : ''
      if (exe && (await pathExists(exe))) return { command: exe, args: [] }
    }
    return null
  }

  async #githubUrl(repoPath: string): Promise<string | null> {
    const { stdout, exitCode } = await this.#git.run(['remote', 'get-url', 'origin'], { repoPath })
    if (exitCode !== 0) return null
    return githubUrlFromRemote(stdout)
  }
}
