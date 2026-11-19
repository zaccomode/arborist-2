/**
 * How captures are uploaded to the image host for a PR body. The plumbing is
 * `scripts/upload-screenshots.ts`; this is the part worth pinning down.
 *
 * Each PR's captures go into a bucket of their own under `SCREENSHOTS_BUCKET`,
 * so one PR's images can be listed, or cleaned up, without sifting through
 * every other PR's. An image is stored once by its hash whichever buckets hold
 * it, so a capture that is unchanged from an earlier PR costs nothing more and
 * keeps its URL.
 */

export const REPO = 'zaccomode/arborist-2'
/** The parent of every PR's bucket. */
export const SCREENSHOTS_BUCKET = 'arborist-2/screenshots'
/** The vendored image-host CLI (#154). */
export const CDN_CLI = 'scripts/vendor/cdn.mjs'
/**
 * The SHA-256 of `CDN_CLI`, which must also match the row in
 * `scripts/vendor/README.md` (a unit test holds the three together). The
 * wrapper refuses to run the CLI, with the upload token in its environment,
 * unless the file on disk hashes to this (#164).
 */
export const CDN_CLI_SHA256 = 'dc92f469ffddb37266ea2955859f90f6d3467035ff148f677eeb532872258476'

/**
 * Throws unless `actual` is the pinned hash. Kept apart from the hashing so
 * the message can be tested without touching the vendored file.
 */
export function assertCliPinned(actual: string): void {
  if (actual !== CDN_CLI_SHA256) {
    throw new Error(
      `${CDN_CLI} hashes to ${actual}, not the pinned ${CDN_CLI_SHA256}. ` +
        'Refusing to run it. If the CLI was bumped on purpose, update CDN_CLI_SHA256 ' +
        'and scripts/vendor/README.md in the same change (see that README).'
    )
  }
}

/**
 * The environment the CLI runs with: the caller's, minus `CDN_API`, which the
 * CLI would otherwise take as the address to send the upload token to.
 */
export function cdnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const rest = { ...env }
  delete rest.CDN_API
  return rest
}

/** The bucket a PR's captures go into, e.g. `arborist-2/screenshots/pr-160`. */
export function prBucket(pr: number): string {
  return `${SCREENSHOTS_BUCKET}/pr-${pr}`
}

export interface UploadArgs {
  pr: number
  files: string[]
}

const USAGE = 'Usage: node scripts/upload-screenshots.ts --pr <number> <files...>'

export function parseUploadArgs(argv: readonly string[]): UploadArgs {
  const files: string[] = []
  let pr: number | undefined

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pr') {
      if (pr !== undefined) throw new Error(`--pr was given twice. ${USAGE}`)
      const value = argv[++i]
      if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
        throw new Error(`--pr needs a PR number. ${USAGE}`)
      }
      pr = Number(value)
    } else if (argv[i].startsWith('-')) {
      // Single-dash names too: the CLI reads `-h` as a request for help
      // before anything else and exits 0, so a capture named `-h` would make
      // the whole upload a silent no-op (#164). Name such a file `./-h`.
      throw new Error(`Unknown option "${argv[i]}". ${USAGE}`)
    } else {
      files.push(argv[i])
    }
  }

  if (pr === undefined) throw new Error(`Pass the PR the captures are for. ${USAGE}`)
  if (files.length === 0) throw new Error(`Name at least one capture to upload. ${USAGE}`)
  return { pr, files }
}

/**
 * The arguments for `cdn.mjs`. `--create` makes the PR's bucket on its first
 * upload and is a no-op after that; `--repo` and `--pr` record where each
 * upload was for, alongside the bucket that groups them.
 */
export function cdnUploadArgs({ pr, files }: UploadArgs): string[] {
  return [
    'upload',
    ...files,
    '--bucket',
    prBucket(pr),
    '--create',
    '--repo',
    REPO,
    '--pr',
    String(pr)
  ]
}
