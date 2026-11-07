/**
 * Fails if the release for a tag is not complete, so a draft that is missing
 * assets cannot be published by mistake.
 *
 * Run by the `assert-complete` job in `.github/workflows/release.yml` after
 * both build legs, and runnable by hand against any release — including one
 * long since published — to see what it would have said:
 *
 *   node scripts/release/assert-release-complete.ts --tag v3.4.0
 *   node scripts/release/assert-release-complete.ts --tag v3.4.0 --manifests ./some-dir
 *
 * `gh` does the talking, so this inherits whatever authentication the shell
 * already has, and sees drafts. `--manifests` points at a directory of
 * already-downloaded `*.yml` files instead of fetching them, which is what
 * makes a dry run possible without touching the release.
 *
 * What counts as complete lives in `expected-assets.ts`, along with the
 * reasoning; this file is only the plumbing.
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { load } from 'js-yaml'
// Node's native type stripping resolves ESM imports literally, so this needs
// the real file extension rather than a bare specifier.
import {
  expectedAssets,
  releaseProblems,
  type BuilderConfig,
  type Manifest,
  type PackageJson,
  type ReleaseAsset
} from './expected-assets.ts'

interface Args {
  tag: string
  repo: string | undefined
  manifests: string | undefined
}

function parseArgs(argv: string[]): Args {
  let tag: string | undefined
  let repo: string | undefined
  let manifests: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1]
    switch (argv[i]) {
      case '--tag':
        tag = value
        i++
        break
      case '--repo':
        repo = value
        i++
        break
      case '--manifests':
        manifests = value
        i++
        break
      default:
        throw new Error(`Unknown argument "${argv[i]}". Expected --tag, --repo or --manifests.`)
    }
  }

  if (tag === undefined) throw new Error('--tag is required, e.g. --tag v3.4.0')
  return { tag, repo, manifests }
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

/**
 * The release for a tag, drafts included. `gh release view` would do, but it
 * resolves a tag to at most one release and this has to notice when a tag has
 * somehow collected two — the split-draft state the `verify` job guards
 * against, which would otherwise read here as a release with half its assets.
 */
function findRelease(
  repo: string,
  tag: string
): { id: number; name: string; draft: boolean; assets: ReleaseAsset[] } {
  const releases = JSON.parse(
    gh(['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--slurp'])
  ) as {
    id: number
    name: string | null
    tag_name: string
    draft: boolean
    assets: ReleaseAsset[]
  }[][]

  const matches = releases.flat().filter((release) => release.tag_name === tag)
  if (matches.length === 0) throw new Error(`No release found for ${tag} in ${repo}.`)
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} releases exist for ${tag}. electron-builder has split the artifacts ` +
        `across them; delete all but one and re-run the release workflow.`
    )
  }

  const release = matches[0]
  return {
    id: release.id,
    name: release.name ?? tag,
    draft: release.draft,
    assets: release.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      state: asset.state
    }))
  }
}

/** Reads every `*.yml` in a directory as an update manifest. */
function readManifests(dir: string): Manifest[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.yml'))
    .map((file) => {
      const parsed = (load(readFileSync(join(dir, file), 'utf8')) ?? {}) as Omit<Manifest, 'name'>
      return { ...parsed, name: file }
    })
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const repo = args.repo ?? process.env['GITHUB_REPOSITORY']
  if (repo === undefined) {
    throw new Error('--repo is required outside Actions, e.g. --repo zaccomode/arborist-2')
  }

  const root = resolve(import.meta.dirname, '../..')
  const config = load(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as BuilderConfig
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson

  // The tag is checked against package.json in the `verify` job; this only
  // needs the version the assets are named after.
  const expected = expectedAssets(config, pkg)
  const release = findRelease(repo, args.tag)

  let manifestDir = args.manifests
  if (manifestDir === undefined) {
    manifestDir = mkdtempSync(join(tmpdir(), 'arborist-manifests-'))
    // Only the manifests, which are a kilobyte between them — downloading the
    // installers to check their length would move half a gigabyte to learn
    // what the API already said.
    try {
      gh([
        'release',
        'download',
        args.tag,
        '--repo',
        repo,
        '--pattern',
        '*.yml',
        '--dir',
        manifestDir
      ])
    } catch {
      // A release with no manifests at all is the failure this exists to
      // catch, and `gh` exits non-zero when its pattern matches nothing.
      // Reported below as the missing assets they are.
    }
  } else if (!existsSync(manifestDir)) {
    throw new Error(`--manifests directory does not exist: ${manifestDir}`)
  }

  const problems = releaseProblems({
    expected,
    assets: release.assets,
    manifests: readManifests(manifestDir),
    version: pkg.version
  })

  console.log(
    `${args.tag} (${release.draft ? 'draft' : 'published'}): ${release.assets.length} assets, ` +
      `${expected.all.length} expected.`
  )
  for (const name of expected.all) {
    const asset = release.assets.find((candidate) => candidate.name === name)
    console.log(`  ${asset === undefined ? '✗' : '✓'} ${name}`)
  }

  if (problems.length > 0) {
    for (const problem of problems) console.log(`::error::${problem}`)
    console.log(
      `::error::${args.tag} is not a complete release (${problems.length} problem(s) above). ` +
        `Do not publish it. Re-run the release workflow on the tag once the cause is understood ` +
        `— docs/release.md has the runbook.`
    )
    process.exit(1)
  }

  console.log(`${args.tag} carries every expected asset, and its manifests agree with them.`)
}

try {
  main()
} catch (error: unknown) {
  console.log(`::error::${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
