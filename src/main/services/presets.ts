import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { shell } from 'electron'
import { AppError } from '../../shared/errors'
import type { Preset } from '../../shared/persisted'
import {
  builtInPresetId,
  githubUrlFromRemote,
  resolvePresets,
  type BuiltInPreset,
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
  },
  {
    builtinId: 'xcode',
    name: 'Xcode',
    icon: 'Hammer',
    platforms: ['darwin'],
    enabledByDefault: false,
    sortOrder: 4
  },
  {
    builtinId: 'warp',
    name: 'Warp',
    icon: 'Terminal',
    platforms: ['darwin'],
    enabledByDefault: false,
    sortOrder: 5
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

/** Runs a command detached, so closing Arborist doesn't take the editor with it. */
function launchDetached(command: string, args: string[], cwd?: string): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', cwd, windowsHide: false })
  child.on('error', (error) => {
    throw new AppError(`Could not run ${command}: ${error.message}`, 'preset-launch-failed')
  })
  child.unref()
}

export class PresetService {
  #store: Store
  #git: GitRunner

  constructor(store: Store, git: GitRunner) {
    this.#store = store
    this.#git = git
  }

  /**
   * Which built-ins this machine can actually offer. A missing editor or a
   * repository with no GitHub remote hides its preset rather than presenting
   * a button that fails when pressed.
   */
  async availableBuiltInIds(repoPath: string | null): Promise<string[]> {
    const available = ['reveal']
    if (process.platform !== 'linux') available.push('terminal')

    if (await this.#vsCodeCommand()) available.push('vscode')
    if (process.platform === 'darwin') {
      if (await pathExists('/Applications/Xcode.app')) available.push('xcode')
      if (await pathExists('/Applications/Warp.app')) available.push('warp')
    }
    if (repoPath && (await this.#githubUrl(repoPath))) available.push('github')

    return available
  }

  async list(repoPath: string | null, projectId: string | null): Promise<ResolvedPreset[]> {
    return resolvePresets({
      builtIns: BUILT_IN_PRESETS,
      availableBuiltInIds: await this.availableBuiltInIds(repoPath),
      presets: this.#store.data.presets,
      config: this.#store.data.presetConfig,
      projectId,
      platform: process.platform
    })
  }

  async run(presetId: string, context: PresetContext): Promise<void> {
    const builtIn = BUILT_IN_PRESETS.find(
      (preset) => builtInPresetId(preset.builtinId) === presetId
    )
    if (builtIn) return this.#runBuiltIn(builtIn.builtinId, context)

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
        launchDetached(command.command, [...command.args, context.path])
        return
      }
      case 'xcode':
        launchDetached('open', ['-a', '/Applications/Xcode.app', context.path])
        return
      case 'warp':
        launchDetached('open', ['-a', '/Applications/Warp.app', context.path])
        return
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

  async #runCustom(preset: Preset, context: PresetContext): Promise<void> {
    switch (preset.command.type) {
      case 'app': {
        // Values reach the app as argv entries, so nothing parses them and
        // nothing needs escaping.
        const target = substitute(preset.command.app, context, 'raw')
        if (process.platform === 'darwin' && target.endsWith('.app')) {
          launchDetached('open', ['-a', target, context.path])
        } else {
          launchDetached(target, [context.path])
        }
        return
      }
      case 'url': {
        const url = substitute(preset.command.url, context, 'url')
        // Only http(s): a preset should not be a way to hand an arbitrary
        // scheme to the operating system.
        if (!/^https?:\/\//i.test(url)) {
          throw new AppError(`${url} is not an http(s) URL.`, 'preset-launch-failed')
        }
        await shell.openExternal(url)
        return
      }
      case 'shell': {
        const powershell = process.platform === 'win32'
        const script = substitute(
          preset.command.script,
          context,
          powershell ? 'powershell' : 'posix'
        )
        if (powershell) {
          launchDetached('powershell', ['-NoProfile', '-Command', script], context.path)
        } else {
          launchDetached('/bin/sh', ['-c', script], context.path)
        }
        return
      }
    }
  }

  #openTerminal(path: string): void {
    if (process.platform === 'darwin') {
      launchDetached('open', ['-a', 'Terminal', path])
      return
    }
    // Windows Terminal is not on every machine, and the fallback is the
    // flakiest launch in the app — which is exactly why custom shell presets
    // exist as an escape hatch.
    which('wt')
      .then((wt) => {
        if (wt) launchDetached('wt', ['-d', path])
        else
          launchDetached('powershell', [
            '-NoExit',
            '-Command',
            `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'`
          ])
      })
      .catch(() => {
        launchDetached('powershell', [
          '-NoExit',
          '-Command',
          `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'`
        ])
      })
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
