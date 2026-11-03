import { resolve } from 'path'

/** Where the few captures worth committing go. */
export const COMMITTED_DIR = 'docs/screenshots'
/** Where every other capture goes: local, gitignored, for reviewing a change. */
export const LOCAL_DIR = '.screenshots'

/**
 * Picks the directory a scenario's PNGs are written to. An explicit `--out`
 * wins for everything; otherwise only scenarios marked `committed` land in the
 * tracked directory, so regenerating the full set doesn't churn the repo.
 */
export function resolveOutDir(scenario: { committed?: boolean }, override?: string): string {
  if (override !== undefined) return resolve(override)
  return resolve(scenario.committed ? COMMITTED_DIR : LOCAL_DIR)
}
