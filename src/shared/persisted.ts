import { z } from 'zod'

export const SCHEMA_VERSION = 2

export const repositorySchema = z.object({
  id: z.string(),
  /** Absolute path to the repository's main worktree. */
  path: z.string(),
  name: z.string(),
  addedAt: z.string()
})

/**
 * What opening a worktree does.
 *
 * `app` is a path to an executable or a macOS .app bundle. v1 stored macOS
 * bundle identifiers, which have no Windows equivalent; a path is the shape
 * both platforms share. Built-in presets store nothing here at all — they
 * carry a builtinId and resolve at run time, so a settings file copied
 * between machines still works.
 */
export const presetCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('app'), app: z.string() }),
  z.object({ type: z.literal('url'), url: z.string() }),
  z.object({ type: z.literal('shell'), script: z.string() })
])

export const presetSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** A lucide icon name, rendered by the Open In grid. */
  icon: z.string().default('SquareArrowOutUpRight'),
  command: presetCommandSchema,
  sortOrder: z.number().default(0),
  enabledByDefault: z.boolean().default(true),
  /** Set when the preset belongs to one project rather than the app. */
  projectId: z.string().nullable().default(null)
})

export const presetConfigSchema = z.object({
  /** Presets, built-in or custom, switched off at the app level. */
  disabledIds: z.array(z.string()).default([]),
  /**
   * Per-project tri-state overrides: `on`, `off`, or absent for inherit.
   * Keyed by project id, then preset id.
   */
  overrides: z.record(z.string(), z.record(z.string(), z.enum(['on', 'off']))).default({}),
  /** Preset ids in display order; anything unlisted follows, in its own order. */
  order: z.array(z.string()).default([])
})

export const automationScriptSchema = z.object({
  repositoryId: z.string(),
  command: z.string(),
  /** Run automatically once a new worktree has been created. */
  runOnCreate: z.boolean().default(false)
})

export const settingsSchema = z.object({
  /** Manual git path; null means discovery decides. */
  gitPath: z.string().nullable().default(null),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /** Log every git command to the console. Off by default: v1 logged always. */
  debugGit: z.boolean().default(false),
  /** How many worktrees are enriched at once during a refresh. */
  refreshConcurrency: z.number().int().min(1).max(32).default(6),
  /** Which shell runs automation lines on Windows. Ignored elsewhere. */
  automationShell: z.enum(['powershell', 'cmd']).default('powershell'),
  /** An explicit shell for automation, for pwsh and zsh users. */
  customShellPath: z.string().nullable().default(null),
  /** Arguments before the command, e.g. `["-c"]`. */
  customShellArgs: z.array(z.string()).default([])
})

export const persistedDataSchema = z.object({
  schemaVersion: z.number().int().positive(),
  repositories: z.array(repositorySchema).default([]),
  /** Repository id → free-text note. */
  notes: z.record(z.string(), z.string()).default({}),
  /** `<repository id>::<worktree path>` → free-text note. */
  worktreeNotes: z.record(z.string(), z.string()).default({}),
  automationScripts: z.array(automationScriptSchema).default([]),
  presets: z.array(presetSchema).default([]),
  presetConfig: presetConfigSchema.default({ disabledIds: [], overrides: {}, order: [] }),
  settings: settingsSchema.default(() => settingsSchema.parse({}))
})

export type Repository = z.infer<typeof repositorySchema>
export type PresetCommand = z.infer<typeof presetCommandSchema>
export type Preset = z.infer<typeof presetSchema>
export type PresetConfig = z.infer<typeof presetConfigSchema>
export type AutomationScript = z.infer<typeof automationScriptSchema>
export type Settings = z.infer<typeof settingsSchema>
export type PersistedData = z.infer<typeof persistedDataSchema>

/** Key for a worktree note. Worktree paths are unique within a repository. */
export function worktreeNoteKey(repositoryId: string, worktreePath: string): string {
  return `${repositoryId}::${worktreePath}`
}

export function defaultData(): PersistedData {
  return persistedDataSchema.parse({ schemaVersion: SCHEMA_VERSION })
}
