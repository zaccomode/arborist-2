import { execFile } from 'child_process'
import type { GitDiscoveryResult } from '../../../shared/domain'
import { execGitAt } from './git-executor'

export interface DiscoveryDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  /** Resolves the absolute path of `git` on PATH, or null. */
  which: (command: string) => Promise<string | null>
  /** Runs `<path> --version` and returns the version, or null if it is not a working git. */
  probe: (path: string) => Promise<string | null>
}

export function knownGitLocations(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): readonly string[] {
  if (platform === 'win32') {
    const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files'
    const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const localAppData = env['LocalAppData'] ?? ''
    const userProfile = env['UserProfile'] ?? ''
    return [
      `${programFiles}\\Git\\cmd\\git.exe`,
      `${programFilesX86}\\Git\\cmd\\git.exe`,
      localAppData ? `${localAppData}\\Programs\\Git\\cmd\\git.exe` : '',
      userProfile ? `${userProfile}\\scoop\\shims\\git.exe` : ''
    ].filter(Boolean)
  }
  // /usr/bin/git exists on a Mac with no developer tools, but it is a stub
  // that prompts for the Xcode CLT rather than running, so it must pass a
  // real `--version` probe like every other candidate.
  return ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git']
}

const notFound: GitDiscoveryResult = {
  found: false,
  path: null,
  version: null,
  source: 'none',
  overrideError: null
}

/**
 * Settings override → `git` on PATH → the platform's known install locations.
 * Every candidate must answer `--version`, so a path that exists but cannot
 * run is passed over rather than becoming a broken selection.
 */
export async function discoverGit(
  overridePath: string | null,
  deps: DiscoveryDeps
): Promise<GitDiscoveryResult> {
  let overrideError: string | null = null

  if (overridePath) {
    const version = await deps.probe(overridePath)
    if (version) {
      return { found: true, path: overridePath, version, source: 'settings', overrideError: null }
    }
    overrideError = `${overridePath} is not a working git executable.`
  }

  const onPath = await deps.which('git')
  if (onPath) {
    const version = await deps.probe(onPath)
    if (version) {
      return { found: true, path: onPath, version, source: 'path', overrideError }
    }
  }

  for (const candidate of knownGitLocations(deps.platform, deps.env)) {
    const version = await deps.probe(candidate)
    if (version) {
      return { found: true, path: candidate, version, source: 'known-location', overrideError }
    }
  }

  return { ...notFound, overrideError }
}

function whichOnSystem(command: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(finder, [command], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const first = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)
      resolve(first ? first.trim() : null)
    })
  })
}

async function probeVersion(path: string): Promise<string | null> {
  try {
    const { stdout, exitCode } = await execGitAt(path, ['--version'], { timeoutMs: 5_000 })
    if (exitCode !== 0) return null
    const match = /git version (\S+)/.exec(stdout)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export function systemDiscoveryDeps(): DiscoveryDeps {
  // Screenshot scenarios and e2e tests need the "git not found" screen, and
  // the only other way to reach it is uninstalling git from the machine.
  const forceMissing = process.env['ARBORIST_FORCE_GIT_MISSING'] === '1'
  return {
    platform: process.platform,
    env: process.env,
    which: forceMissing ? async () => null : whichOnSystem,
    probe: forceMissing ? async () => null : probeVersion
  }
}

/**
 * Caches the discovery result for the process. Settings changes call
 * `invalidate` so the next lookup re-runs rather than serving a stale path.
 */
export class GitLocator {
  #deps: DiscoveryDeps
  #override: string | null
  #cached: Promise<GitDiscoveryResult> | null = null

  constructor(deps: DiscoveryDeps = systemDiscoveryDeps(), override: string | null = null) {
    this.#deps = deps
    this.#override = override
  }

  discover(): Promise<GitDiscoveryResult> {
    this.#cached ??= discoverGit(this.#override, this.#deps)
    return this.#cached
  }

  setOverride(override: string | null): void {
    this.#override = override
    this.invalidate()
  }

  invalidate(): void {
    this.#cached = null
  }
}
