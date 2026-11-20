/**
 * Uploads screenshot captures for a PR body into that PR's own bucket on the
 * image host, and prints their markdown to paste. See CLAUDE.md, "Before
 * opening a pull request", step 4.
 *
 *   node scripts/upload-screenshots.ts --pr 160 .screenshots/shell-dark.png .screenshots/shell-light.png
 *
 * The bucket and arguments are decided in `screenshots/upload.ts`; this only
 * runs the vendored CLI with them.
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
// Node's native type stripping resolves ESM imports literally, so this needs
// the real file extension rather than a bare specifier.
import {
  assertCliPinned,
  CDN_CLI,
  cdnEnv,
  cdnUploadArgs,
  parseUploadArgs
} from './screenshots/upload.ts'

let args
try {
  args = parseUploadArgs(process.argv.slice(2))
} catch (error) {
  console.error((error as Error).message)
  process.exit(2)
}

const cli = resolve(import.meta.dirname, '..', CDN_CLI)
try {
  assertCliPinned(createHash('sha256').update(readFileSync(cli)).digest('hex'))
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}

const result = spawnSync(process.execPath, [cli, ...cdnUploadArgs(args)], {
  stdio: 'inherit',
  env: cdnEnv(process.env)
})
if (result.error) console.error(`Could not run ${CDN_CLI}: ${result.error.message}`)
else if (result.signal) console.error(`${CDN_CLI} was killed by ${result.signal}`)
process.exit(result.status ?? 1)
