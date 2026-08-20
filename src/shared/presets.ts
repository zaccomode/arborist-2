/**
 * How "Open in…" presets resolve for a given project and platform.
 *
 * Pure, so the settings UI can show what a tri-state override will actually
 * do without asking the main process, and so the matrix below can be tested
 * without a repository or a desktop.
 */
import type { Preset, PresetConfig } from './persisted'

export type PresetOverride = 'on' | 'off'

export interface BuiltInPreset {
  builtinId: string
  name: string
  icon: string
  /** Empty means every platform. */
  platforms: NodeJS.Platform[]
  enabledByDefault: boolean
  sortOrder: number
}

/** A preset as the UI shows it, whether built in or the user's own. */
export interface ResolvedPreset {
  id: string
  name: string
  icon: string
  builtinId: string | null
  /** Project-specific presets are appended after the app-level ones. */
  projectId: string | null
}

/** What the settings UI needs to show and edit presets, in one round trip. */
export interface PresetCatalogue {
  builtIns: Array<BuiltInPreset & { id: string; available: boolean; enabled: boolean }>
  presets: Preset[]
  config: PresetConfig
}

export function builtInPresetId(builtinId: string): string {
  return `builtin:${builtinId}`
}

function enabledFor(
  id: string,
  defaultEnabled: boolean,
  config: PresetConfig,
  projectId: string | null
): boolean {
  const override = projectId ? config.overrides[projectId]?.[id] : undefined
  if (override) return override === 'on'
  if (config.disabledIds.includes(id)) return false
  return defaultEnabled
}

/**
 * App-level presets — built-ins the platform supports and could detect, then
 * the user's own — filtered by the project's tri-state overrides and ordered,
 * with the project's own presets appended.
 */
export function resolvePresets(input: {
  builtIns: readonly BuiltInPreset[]
  /** Built-ins whose target was actually found on this machine. */
  availableBuiltInIds: readonly string[]
  presets: readonly Preset[]
  config: PresetConfig
  projectId: string | null
  platform: NodeJS.Platform
}): ResolvedPreset[] {
  const { builtIns, availableBuiltInIds, presets, config, projectId, platform } = input

  const builtInEntries = builtIns
    .filter((preset) => preset.platforms.length === 0 || preset.platforms.includes(platform))
    .filter((preset) => availableBuiltInIds.includes(preset.builtinId))
    .map((preset) => ({
      resolved: {
        id: builtInPresetId(preset.builtinId),
        name: preset.name,
        icon: preset.icon,
        builtinId: preset.builtinId,
        projectId: null
      } satisfies ResolvedPreset,
      rank: preset.sortOrder,
      defaultEnabled: preset.enabledByDefault
    }))

  const customEntries = presets
    .filter((preset) => preset.projectId === null)
    .map((preset) => ({
      resolved: {
        id: preset.id,
        name: preset.name,
        icon: preset.icon,
        builtinId: null,
        projectId: null
      } satisfies ResolvedPreset,
      // Behind every built-in, whatever their own sortOrder values are.
      rank: 1000 + preset.sortOrder,
      defaultEnabled: preset.enabledByDefault
    }))

  const appLevel = [...builtInEntries, ...customEntries]
    .filter((entry) => enabledFor(entry.resolved.id, entry.defaultEnabled, config, projectId))
    .sort((a, b) => orderOf(a.resolved.id, a.rank, config) - orderOf(b.resolved.id, b.rank, config))
    .map((entry) => entry.resolved)

  const projectLevel = projectId
    ? presets
        .filter((preset) => preset.projectId === projectId)
        .filter((preset) => enabledFor(preset.id, preset.enabledByDefault, config, projectId))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((preset): ResolvedPreset => ({
          id: preset.id,
          name: preset.name,
          icon: preset.icon,
          builtinId: null,
          projectId
        }))
    : []

  return [...appLevel, ...projectLevel]
}

/** An explicit order wins; anything unlisted keeps its default rank, after. */
function orderOf(id: string, rank: number, config: PresetConfig): number {
  const index = config.order.indexOf(id)
  return index === -1 ? 10_000 + rank : index
}

/**
 * Turns an origin remote into the repository's GitHub URL, normalising the
 * ssh forms. Returns null for anything that isn't GitHub, which is what hides
 * the built-in rather than offering a link that goes nowhere.
 */
export function githubUrlFromRemote(remote: string): string | null {
  const url = remote.trim().replace(/\.git$/, '')
  if (!url) return null

  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/](.+)$/.exec(url)
  if (ssh) return `https://github.com/${ssh[1]}`

  const https = /^https?:\/\/(?:[^@]+@)?github\.com\/(.+)$/.exec(url)
  if (https) return `https://github.com/${https[1]}`

  return null
}
