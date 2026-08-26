/**
 * `{{token}}` templating for open presets and setup automation.
 *
 * v1 substituted with a plain string replace, so a branch name containing a
 * quote broke the script it was pasted into. Values here are escaped for
 * wherever they are going, which is something only the caller knows, so the
 * destination is a parameter.
 *
 * Nothing here imports Node: the preset and automation previews use it
 * directly in the renderer.
 */

export interface SubstitutionValues {
  path: string
  branch: string | null
  commitHash: string | null
  repoName: string
  repoPath: string
  /** The conflicted (or otherwise selected) file, absolute. Null for a worktree-target preset. */
  filePath: string | null
  /** Not in scope for #53 — conflict-marker parsing isn't done, so this stays null there too. */
  fileLine: number | null
}

export const KNOWN_TOKENS = [
  'path',
  'branch',
  'commitHash',
  'repoName',
  'repoPath',
  'filePath',
  'fileLine'
] as const

export type TokenName = (typeof KNOWN_TOKENS)[number]

/**
 * Where a substituted value is about to land:
 *
 * - `raw` — an argv entry, which the OS passes to the process verbatim.
 * - `url` — a URL template, so each value is percent-encoded.
 * - `posix` / `powershell` — a command line the user wrote. Only the values
 *   are quoted; their own shell syntax is left to work as they intended.
 */
export type SubstitutionMode = 'raw' | 'url' | 'posix' | 'powershell'

const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

function escapeValue(value: string, mode: SubstitutionMode): string {
  switch (mode) {
    case 'raw':
      return value
    case 'url':
      return encodeURIComponent(value)
    case 'posix':
      // Single quotes make everything literal, so the only thing needing care
      // is a single quote itself: close, escape one, reopen.
      return `'${value.replace(/'/g, `'\\''`)}'`
    case 'powershell':
      return `'${value.replace(/'/g, `''`)}'`
  }
}

function isKnownToken(name: string): name is TokenName {
  return (KNOWN_TOKENS as readonly string[]).includes(name)
}

/**
 * Replaces the known tokens in `template`, escaping each value for `mode`.
 *
 * An unknown token is left exactly as written rather than erroring: a typo
 * failing loudly at edit time, where the preview shows it, beats the same
 * typo failing halfway through an automation run.
 */
export function substitute(
  template: string,
  values: SubstitutionValues,
  mode: SubstitutionMode
): string {
  return template.replace(TOKEN_PATTERN, (match, name: string) => {
    if (!isKnownToken(name)) return match
    const raw = values[name]
    // `fileLine` is the one numeric token; every other token is already a
    // string or null. `String(raw)` rather than a type-specific branch, since
    // a future numeric token needs no new case here.
    const value = raw === null || raw === undefined ? '' : String(raw)
    return escapeValue(value, mode)
  })
}

/** The tokens in `template` that `substitute` will not replace, in order of appearance. */
export function findUnknownTokens(template: string): string[] {
  const unknown: string[] = []
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const name = match[1]
    if (!isKnownToken(name) && !unknown.includes(name)) unknown.push(name)
  }
  return unknown
}
