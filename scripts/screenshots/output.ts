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

/** The themes every scenario is captured in, in the order the table shows them. */
export const THEMES = ['dark', 'light'] as const

export interface ScreenshotArgs {
  /** Where PNGs go, if not `LOCAL_DIR`. */
  outDir: string | undefined
  /** Scenarios to run; empty means all of them. */
  names: string[]
  /**
   * Whether the run records its hashes in `MANIFEST_PATH` and the README's
   * key-screens table. Off under `--out` (#155): a run aimed somewhere else
   * is a preview or a flakiness check, and letting it rewrite the committed
   * manifest is how a macOS preview's hashes, or whichever of a flaky
   * scenario's renderings ran last, end up committed.
   */
  recordManifest: boolean
}

export function parseScreenshotArgs(argv: readonly string[]): ScreenshotArgs {
  const names: string[] = []
  let outDir: string | undefined

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new Error('--out needs a directory')
      outDir = value
    } else if (argv[i].startsWith('--')) {
      throw new Error(`Unknown option "${argv[i]}". Options: --out <directory>`)
    } else {
      names.push(argv[i])
    }
  }

  return { outDir, names, recordManifest: outDir === undefined }
}
