import { execFile, spawn } from 'child_process'
import { promises as fs } from 'fs'
import { shell } from 'electron'
import { AppError } from '../../shared/errors'
import type { Preset } from '../../shared/persisted'
import {
  builtInPresetId,
  enabledAtAppLevel,
  FILE_CAPABLE_BUILTINS,
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
import { isTransientSpawnCode, OUT_OF_RESOURCES_ADVICE, retryTransientSpawn } from './system/spawn'
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

/**
 * `'worktree'` is every preset call before #53: the target is the worktree
 * directory (`context.path`). `'file'` is the Conflicts section's "Open in
 * editor" — the target is `context.filePath`, and built-ins with no sensible
 * per-file behaviour are rejected rather than silently opening the worktree
 * instead (`filterForTarget` is what keeps them off the UI's list in the
 * first place; this is the defensive check for anything that calls `run`
 * directly).
 */
export type PresetTarget = 'worktree' | 'file'

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * The code a preset launch throws when the machine could not start a process
 * at all, rather than when the app behind the preset is missing (#83). Kept
 * distinct from `'preset-launch-failed'` so `retryTransientSpawn` retries
 * only the failures a second attempt can actually clear.
 */
export const PRESET_SPAWN_FAILED_CODE = 'preset-spawn-failed'

/**
 * Types a raw spawn error, whether Node reported it asynchronously or threw
 * it out of the `spawn`/`execFile` call. An untyped one reached the renderer
 * as a bare `spawn EBADF` under a "Could not open" toast, which named neither
 * what failed nor what to do about it — #83.
 */
function launchFailure(command: string, error: unknown): AppError {
  const failure = error as NodeJS.ErrnoException
  return isTransientSpawnCode(failure.code)
    ? new AppError(
        `Could not start ${command}: ${failure.message}. ${OUT_OF_RESOURCES_ADVICE}`,
        PRESET_SPAWN_FAILED_CODE
      )
    : new AppError(`Could not run ${command}: ${failure.message}`, 'preset-launch-failed')
}

/**
 * Runs a command detached, so closing Arborist doesn't take the editor with
 * it, but waits long enough to know the process actually started. Nothing
 * pre-checks that a target is installed any more, so "the binary isn't there"
 * has to come back as an error rather than as nothing happening.
 */
function launchDetached(command: string, args: string[], cwd?: string): Promise<void> {
  return retryTransientSpawn(PRESET_SPAWN_FAILED_CODE, () => launchDetachedOnce(command, args, cwd))
}

function launchDetachedOnce(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // `spawn` throws, synchronously, for every errno outside the handful
    // `ChildProcess.prototype.spawn` reports through an error event — see
    // `isTransientSpawnCode`. That throw rejects this promise with the raw
    // error rather than the typed one, so it needs catching here.
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', cwd, windowsHide: false })
    } catch (error) {
      reject(launchFailure(command, error))
      return
    }
    child.once('error', (error) => reject(launchFailure(command, error)))
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
  return retryTransientSpawn(PRESET_SPAWN_FAILED_CODE, () => openAppOnce(app, path))
}

function openAppOnce(app: string, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSettled = (error: Error | null, _stdout: string, stderr: string): void => {
      if (!error) {
        resolve()
        return
      }
      // A non-zero exit from `open` itself says the app was not there, and
      // its own stderr says it better than this app could. Only a failure to
      // start `open` at all is a spawn failure worth typing as one.
      const failure = error as NodeJS.ErrnoException
      if (typeof failure.code === 'number' || stderr.trim()) {
        reject(new AppError(stderr.trim() || `Could not open ${app}.`, 'preset-launch-failed'))
        return
      }
      reject(launchFailure('open', failure))
    }

    try {
      execFile('open', ['-a', app, path], onSettled)
    } catch (error) {
      reject(launchFailure('open', error))
    }
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

  async run(
    presetId: string,
    context: PresetContext,
    target: PresetTarget = 'worktree'
  ): Promise<PresetRunResult> {
    if (target === 'file' && !context.filePath) {
      throw new AppError('No file to open.', 'preset-launch-failed')
    }

    const builtIn = BUILT_IN_PRESETS.find(
      (preset) => builtInPresetId(preset.builtinId) === presetId
    )
    if (builtIn) {
      if (target === 'file' && !FILE_CAPABLE_BUILTINS.has(builtIn.builtinId)) {
        throw new AppError(`${builtIn.name} can't open a single file.`, 'preset-launch-failed')
      }
      await this.#runBuiltIn(builtIn.builtinId, context, target)
      return { kind: 'launched' }
    }

    const custom = this.#store.data.presets.find((preset) => preset.id === presetId)
    if (!custom) throw new AppError(`No preset with id ${presetId}.`, 'preset-not-found')
    return this.#runCustom(custom, context, target)
  }

  async #runBuiltIn(
    builtinId: string,
    context: PresetContext,
    target: PresetTarget
  ): Promise<void> {
    switch (builtinId) {
      case 'reveal': {
        // `showItemInFolder` reveals one file — its own directory shown with
        // the file selected — where `openPath` on the directory just opens
        // the folder with nothing picked out.
        if (target === 'file' && context.filePath) {
          shell.showItemInFolder(context.filePath)
          return
        }
        const error = await shell.openPath(context.path)
        if (error) throw new AppError(error, 'preset-launch-failed')
        return
      }
      case 'terminal':
        return this.#openTerminal(context.path)
      case 'vscode': {
        const command = await this.#vsCodeCommand()
        if (!command) throw new AppError('VS Code was not found.', 'preset-launch-failed')
        if (target === 'file' && context.filePath) {
          const goto = context.fileLine
            ? `${context.filePath}:${context.fileLine}`
            : context.filePath
          return launchDetached(command.command, [...command.args, '--goto', goto])
        }
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

  async #runCustom(
    preset: Preset,
    context: PresetContext,
    target: PresetTarget
  ): Promise<PresetRunResult> {
    // Everything but a shell preset's cwd targets the file directly when
    // asked to; a shell preset always runs with the worktree as its cwd and
    // reaches the file, if it wants it, through the `{{filePath}}` token.
    const targetPath = target === 'file' && context.filePath ? context.filePath : context.path

    switch (preset.command.type) {
      case 'app': {
        // Values reach the app as argv entries, so nothing parses them and
        // nothing needs escaping.
        const app = substitute(preset.command.app, context, 'raw')
        if (process.platform === 'darwin' && app.endsWith('.app')) {
          await openApp(app, targetPath)
        } else {
          await launchDetached(app, [targetPath])
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
      // The default per-user install location the NSIS installer uses when
      // "Add to PATH" was left unchecked, then the machine-wide one a
      // system-level install (or an admin pushing it via `ProgramFiles`)
      // uses instead. Both are `Code.exe` directly rather than the `bin`
      // wrapper scripts, which sidesteps #63's `where`-ordering problem
      // entirely — a real `.exe` needs no shell and nothing to disambiguate.
      const local = process.env['LocalAppData']
      const programFiles = process.env['ProgramFiles']
      const candidates = [
        local ? `${local}\\Programs\\Microsoft VS Code\\Code.exe` : null,
        programFiles ? `${programFiles}\\Microsoft VS Code\\Code.exe` : null
      ].filter((path): path is string => path !== null)

      for (const exe of candidates) {
        if (await pathExists(exe)) return { command: exe, args: [] }
      }
    }
    return null
  }

  async #githubUrl(repoPath: string): Promise<string | null> {
    const { stdout, exitCode } = await this.#git.run(['remote', 'get-url', 'origin'], { repoPath })
    if (exitCode !== 0) return null
    return githubUrlFromRemote(stdout)
  }
}
