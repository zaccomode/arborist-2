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

/**
 * Joins path segments with the separator for `platform`, so callers in
 * `src/shared` — which cannot import `path` — can build a path for a
 * platform other than the one they're running on (win32 is testable from a
 * Mac). No `..`/`.` resolution: every caller here is joining names it built
 * itself, never a path a user typed.
 */
export function joinPath(platform: NodeJS.Platform, ...parts: string[]): string {
  const separator = platform === 'win32' ? '\\' : '/'
  return parts
    .filter((part) => part.length > 0)
    .map((part, index) =>
      index === 0 ? part.replace(/[/\\]+$/, '') : part.replace(/^[/\\]+|[/\\]+$/g, '')
    )
    .join(separator)
}

/**
 * The parent of `path` on `platform`, the pure counterpart to Node's
 * `dirname`. A bare name with no separator is its own parent (`.`), matching
 * `dirname`'s own behaviour; a win32 drive root keeps its trailing backslash
 * (`dirname("C:\\repo")` is `"C:\\"`, not `"C:"`).
 */
export function parentPath(platform: NodeJS.Platform, path: string): string {
  const isSep = (ch: string | undefined): boolean =>
    ch !== undefined && (platform === 'win32' ? ch === '\\' || ch === '/' : ch === '/')

  let end = path.length
  while (end > 0 && isSep(path[end - 1])) end--
  if (end === 0) return path.slice(0, 1) || path // all separators, or empty: its own root

  let index = end
  while (index > 0 && !isSep(path[index - 1])) index--
  if (index === 0) return '.' // no separator at all: a bare relative name

  let parentEnd = index
  while (parentEnd > 0 && isSep(path[parentEnd - 1])) parentEnd--

  const result = parentEnd === 0 ? path.slice(0, index) : path.slice(0, parentEnd)
  return platform === 'win32' && /^[a-zA-Z]:$/.test(result) ? `${result}\\` : result
}
