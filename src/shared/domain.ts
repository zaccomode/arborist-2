/**
 * Domain types shared by main and renderer. Pure type declarations: no
 * behaviour, no imports, nothing platform-specific.
 */

export type GitSource = 'settings' | 'path' | 'known-location' | 'none'

export interface GitDiscoveryResult {
  found: boolean
  path: string | null
  version: string | null
  source: GitSource
  /** Set when a settings override was supplied but did not run. */
  overrideError: string | null
}
