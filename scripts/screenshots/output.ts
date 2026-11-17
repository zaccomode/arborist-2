import { resolve } from 'path'

/**
 * Where captures are written: local and gitignored. PNGs are never committed;
 * they go to the image host, and only their hashes are tracked, in
 * `MANIFEST_PATH`.
 */
export const LOCAL_DIR = '.screenshots'
/** Every capture's SHA-256, committed so `git diff` on it is the regression check. */
export const MANIFEST_PATH = 'docs/screenshots/manifest.json'
/** Shows the key screens from the image host, by the hashes in the manifest. */
export const README_PATH = 'docs/screenshots/README.md'

/** Picks the directory PNGs are written to: `--out` if given, else `LOCAL_DIR`. */
export function resolveOutDir(override?: string): string {
  return resolve(override ?? LOCAL_DIR)
}
