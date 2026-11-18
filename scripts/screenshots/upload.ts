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
      const value = argv[++i]
      if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
        throw new Error(`--pr needs a PR number. ${USAGE}`)
      }
      pr = Number(value)
    } else if (argv[i].startsWith('--')) {
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
