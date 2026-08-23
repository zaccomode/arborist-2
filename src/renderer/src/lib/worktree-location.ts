import { rootConflictsWithProject as checkRootConflict } from '@shared/worktree-location'

/**
 * `rootConflictsWithProject`, bound to the platform the app is running on.
 * The shared version takes the platform as an argument because it has no
 * `process` to read it from — the renderer is sandboxed and has no `process`
 * at all — so it comes across the preload bridge instead, the same
 * convention `lib/paths.ts`'s `samePath` uses.
 */
export function rootConflictsWithProject(root: string, projectPaths: readonly string[]): boolean {
  return checkRootConflict(root, projectPaths, window.arborist.platform)
}
