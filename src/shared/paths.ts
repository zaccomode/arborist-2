/**
 * Path handling that main and renderer both need, and that differs by
 * platform. Pure string functions: nothing here touches `path` or `fs`, so
 * the win32 behaviour is testable from a Mac and vice versa.
 */

/**
 * Git prints paths with forward slashes, even on Windows, while every path
 * the app builds itself uses backslashes. Normalising everything git says,
 * as it is read, is what lets the two compare equal — and they are compared
 * constantly: selecting a worktree, keying its note, deleting it, showing a
 * project's own location.
 *
 * It is also what keeps forward slashes off a Windows screen. Every path the
 * UI displays came from git, so normalising at the boundary is the only place
 * this has to be got right.
 */
export function normaliseGitPath(
  path: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? path.replace(/\//g, '\\') : path
}

/**
 * A path reduced to the form two paths must share to be the same path.
 *
 * On win32 that means folding case, because NTFS is case-insensitive and the
 * case a path arrives in depends on who typed it: `C:\Users\Iso\code` from the
 * folder picker and `c:\users\iso\code` from a shell are one directory, and
 * comparing them raw adds the project twice. A trailing separator goes too,
 * since a picker and git disagree about whether a directory has one.
 *
 * Only for comparison. Never store or display the result — the user's own
 * casing is the casing they should see.
 */
export function normaliseForCompare(
  path: string,
  platform: NodeJS.Platform = process.platform
): string {
  const normalised = normaliseGitPath(path, platform)
  const separator = platform === 'win32' ? '\\' : '/'
  // A lone `/` (or `C:\`) is a real path rather than an empty one, so the
  // trailing separator only comes off when something precedes it.
  const trimmed =
    normalised.length > 1 && normalised.endsWith(separator) ? normalised.slice(0, -1) : normalised
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

/** Whether two paths name the same location on this platform. */
export function samePath(
  a: string | null | undefined,
  b: string | null | undefined,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (a == null || b == null) return false
  return normaliseForCompare(a, platform) === normaliseForCompare(b, platform)
}
