/**
 * Where a new worktree goes: beside the repository (today's behaviour) or
 * under one central directory. Pure, so the settings UI can show what a
 * tri-state override resolves to without a round trip to main, and so
 * `worktreeBasePath` can be tested on win32 from a Mac.
 *
 * Modelled on `enabledFor` in `presets.ts`: the project's own setting wins
 * when present, otherwise the app-level one applies.
 */
import { sanitizeForFolder } from './branch-name'
import { joinPath, normaliseForCompare, parentPath } from './paths'
import type { ProjectSettings, Settings } from './persisted'

export type WorktreeLocationMode = 'beside' | 'central'

export interface ResolvedLocation {
  mode: WorktreeLocationMode
  /** The central directory. Null when `mode` is `'beside'`. */
  root: string | null
}

/** The project's own setting wins when present; otherwise the app-level one applies. */
export function resolveWorktreeLocation(
  app: Pick<Settings, 'worktreeLocation' | 'worktreeRoot'>,
  project: Pick<ProjectSettings, 'worktreeLocation' | 'worktreeRoot'> | undefined
): ResolvedLocation {
  const mode = project?.worktreeLocation ?? app.worktreeLocation
  if (mode === 'beside') return { mode, root: null }

  const root = project?.worktreeLocation ? (project.worktreeRoot ?? null) : app.worktreeRoot
  return { mode, root }
}

export interface WorktreeBasePathInput {
  location: ResolvedLocation
  repoPath: string
  repoName: string
  branch: string
  /** A parameter, so win32 is testable from a Mac. */
  platform: NodeJS.Platform
}

/**
 * The default candidate path for a new worktree — before the caller
 * de-duplicates onto it with a `-2`, `-3` suffix, which is why this takes
 * the whole string rather than a directory: appending a suffix to the
 * result here is byte-identical to appending it to the folder name first
 * and then joining, so the caller needs nothing more than string
 * concatenation to de-duplicate.
 *
 * `'central'` → `<root>/<repoName>/<sanitizeForFolder(branch)>`. `'beside'`
 * → `<parent of repoPath>/<sanitizeForFolder(branch)>`, byte-identical to
 * today.
 */
export function worktreeBasePath(input: WorktreeBasePathInput): string {
  const { location, repoPath, repoName, branch, platform } = input
  const folder = sanitizeForFolder(branch)

  if (location.mode === 'central' && location.root) {
    return joinPath(platform, location.root, repoName, folder)
  }
  return joinPath(platform, parentPath(platform, repoPath), folder)
}

/**
 * Whether `root` is the same as, or nested inside, one of `projectPaths` —
 * checked at pick time in the settings UI, because letting a central
 * directory land inside a registered project would be a disaster: every
 * worktree for every other project would show up as untracked changes in
 * that one.
 */
export function rootConflictsWithProject(
  root: string,
  projectPaths: readonly string[],
  platform: NodeJS.Platform = process.platform
): boolean {
  const normalisedRoot = normaliseForCompare(root, platform)
  const separator = platform === 'win32' ? '\\' : '/'

  return projectPaths.some((projectPath) => {
    const normalisedProject = normaliseForCompare(projectPath, platform)
    return (
      normalisedRoot === normalisedProject ||
      normalisedRoot.startsWith(`${normalisedProject}${separator}`)
    )
  })
}
