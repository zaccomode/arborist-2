import { z } from 'zod'

export const SCHEMA_VERSION = 4

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

export const presetOverrideSchema = z.enum(['on', 'off'])

export const presetConfigSchema = z.object({
  /**
   * App-level switches, keyed by preset id: `on`, `off`, or absent to take the
   * preset's own default. This was a list of ids switched off, which could
   * only say "off" — so a preset that defaults to off had no way to be
   * switched on.
   */
  appOverrides: z.record(z.string(), presetOverrideSchema).default({}),
  /**
   * Per-project tri-state overrides: `on`, `off`, or absent for inherit.
   * Keyed by project id, then preset id.
   */
  overrides: z.record(z.string(), z.record(z.string(), presetOverrideSchema)).default({}),
  /** Preset ids in display order; anything unlisted follows, in its own order. */
  order: z.array(z.string()).default([])
})

export const automationScriptSchema = z.object({
  repositoryId: z.string(),
  /** The script itself. A project with one runs it on every worktree it creates. */
  command: z.string()
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
  customShellArgs: z.array(z.string()).default([]),
  /**
   * Auto-fetch interval, in minutes; 0 means off, which is the default.
   * Polling a corporate remote every few minutes from an app the user forgot
   * is open is a way to get IT emails, so this is opt-in.
   */
  autoFetchIntervalMinutes: z
    .union([z.literal(0), z.literal(5), z.literal(15), z.literal(60)])
    .default(0),
  /** Sidebar panel width, in pixels. Fixed rather than relative to the window. */
  sidebarWidth: z.number().int().min(200).max(420).default(260),
  /** `'beside'` (today's behaviour) or `'central'`, the app-wide default. */
  worktreeLocation: z.enum(['beside', 'central']).default('beside'),
  /** The central directory, when `worktreeLocation` is `'central'`. */
  worktreeRoot: z.string().nullable().default(null),
  /** Which preset opens a conflicted file's editor. Null resolves to the first file-capable enabled preset. Phase 10 uses it. */
  conflictEditorPresetId: z.string().nullable().default(null),
  /**
   * The sidebar's list ordering (#77). App-wide rather than per project:
   * an order chosen on one repository is the order every repository uses,
   * since the alternative is the same list arriving differently depending on
   * which project you opened last. Mirrors `ListSort` in
   * `src/shared/list-view.ts`, which cannot be imported here — that module
   * imports domain types, and this one is the persistence contract.
   */
  worktreeSort: z.enum(['alphabetical', 'recently-updated']).default('alphabetical'),
  /** Pins the main worktree above the rest of the list. On by default, per #77. */
  worktreeSortMainFirst: z.boolean().default(true),
  remoteBranchSort: z.enum(['alphabetical', 'recently-updated']).default('alphabetical')
})

/**
 * A project's overrides of the app-wide settings above — the same tri-state
 * pattern as `presetConfigSchema.overrides`: a field absent here means
 * inherit the app-level value, and that has to be expressible, which is
 * exactly what a boolean (see `presetConfigSchema.appOverrides`'s history)
 * cannot do.
 */
export const projectSettingsSchema = z.object({
  /** Absent means inherit. Never a boolean. */
  worktreeLocation: z.enum(['beside', 'central']).optional(),
  worktreeRoot: z.string().nullable().optional(),
  conflictEditorPresetId: z.string().nullable().optional()
})

export const selectionSchema = z.object({
  /** The last project the user had open. */
  projectId: z.string().nullable().default(null),
  /** Project id → the worktree path last selected within it. */
  worktreeByProject: z.record(z.string(), z.string()).default({}),
  /** Project id → the remote branch name last selected within it. */
  remoteBranchByProject: z.record(z.string(), z.string()).default({})
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
  presetConfig: presetConfigSchema.default({ appOverrides: {}, overrides: {}, order: [] }),
  settings: settingsSchema.default(() => settingsSchema.parse({})),
  selection: selectionSchema.default(() => selectionSchema.parse({})),
  /** Project id → its settings overrides. A sibling of `notes`, not a field on `repositorySchema` — `repositories` is an array, and a record keyed by id is the idiom every other per-project thing here uses. */
  projectSettings: z.record(z.string(), projectSettingsSchema).default({}),
  /** `${repositoryId}::${worktreePath}` → draft commit message. Phase 5 uses it. */
  commitDrafts: z.record(z.string(), z.string()).default({})
})

export type Repository = z.infer<typeof repositorySchema>
export type PresetCommand = z.infer<typeof presetCommandSchema>
export type Preset = z.infer<typeof presetSchema>
export type PresetConfig = z.infer<typeof presetConfigSchema>
export type AutomationScript = z.infer<typeof automationScriptSchema>
export type Settings = z.infer<typeof settingsSchema>
export type ProjectSettings = z.infer<typeof projectSettingsSchema>
export type SelectionState = z.infer<typeof selectionSchema>
export type PersistedData = z.infer<typeof persistedDataSchema>

/** Key for a worktree note. Worktree paths are unique within a repository. */
export function worktreeNoteKey(repositoryId: string, worktreePath: string): string {
  return `${repositoryId}::${worktreePath}`
}

/** Key for a commit message draft, into `commitDrafts`. Phase 5 uses it. */
export function commitDraftKey(repositoryId: string, worktreePath: string): string {
  return `${repositoryId}::${worktreePath}`
}

export function defaultData(): PersistedData {
  return persistedDataSchema.parse({ schemaVersion: SCHEMA_VERSION })
}
