import { childPath as joinChild, samePath as comparePaths } from '@shared/paths'

/**
 * `samePath`, bound to the platform the app is running on. The shared version
 * takes the platform as an argument because it has no `process` to read it
 * from; in the renderer it comes across the preload bridge, and threading it
 * through every call site would be noise.
 */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  return comparePaths(a, b, window.arborist.platform)
}

/** `childPath`, bound to the platform the app is running on. */
export function childPath(parent: string, name: string): string {
  return joinChild(parent, name, window.arborist.platform)
}
