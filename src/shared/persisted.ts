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
 * What opening a worktree does. `app` and `url` are handed to the OS, so
 * their values are never parsed by a shell; `shell` is a command line the
 * user wrote, and only the substituted values in it are escaped.
 */
export const openActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('app'), app: z.string(), args: z.array(z.string()).default([]) }),
  z.object({ type: z.literal('url'), url: z.string() }),
  z.object({ type: z.literal('shell'), command: z.string() })
])

export const openPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  action: openActionSchema,
  /** Platforms the preset makes sense on; empty means every platform. */
  platforms: z.array(z.enum(['darwin', 'win32', 'linux'])).default([])
})

export const presetConfigSchema = z.object({
  /** Built-ins the user has turned off. They are not persisted as presets. */
  hiddenBuiltInIds: z.array(z.string()).default([]),
  /** Preset ids in display order; anything unlisted follows, built-ins first. */
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
  refreshConcurrency: z.number().int().min(1).max(32).default(6)
})

export const persistedDataSchema = z.object({
  schemaVersion: z.number().int().positive(),
  repositories: z.array(repositorySchema).default([]),
  /** Repository id → free-text note. */
  notes: z.record(z.string(), z.string()).default({}),
  /** `<repository id>::<worktree path>` → free-text note. */
  worktreeNotes: z.record(z.string(), z.string()).default({}),
  automationScripts: z.array(automationScriptSchema).default([]),
  presets: z.array(openPresetSchema).default([]),
  presetConfig: presetConfigSchema.default({ hiddenBuiltInIds: [], order: [] }),
  settings: settingsSchema.default({
    gitPath: null,
    theme: 'system',
    debugGit: false,
    refreshConcurrency: 6
  })
})

export type Repository = z.infer<typeof repositorySchema>
export type OpenAction = z.infer<typeof openActionSchema>
export type OpenPreset = z.infer<typeof openPresetSchema>
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
