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
import { resolve } from 'path'
// Node's native type stripping resolves ESM imports literally, so this needs
// the real file extension rather than a bare specifier.
import { CDN_CLI, cdnUploadArgs, parseUploadArgs } from './screenshots/upload.ts'

let args
try {
  args = parseUploadArgs(process.argv.slice(2))
} catch (error) {
  console.error((error as Error).message)
  process.exit(2)
}

const cli = resolve(import.meta.dirname, '..', CDN_CLI)
const result = spawnSync(process.execPath, [cli, ...cdnUploadArgs(args)], { stdio: 'inherit' })
process.exit(result.status ?? 1)
