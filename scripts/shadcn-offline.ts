// Runs the shadcn CLI against a registry built on this machine, for containers
// that cannot reach ui.shadcn.com. See CLAUDE.md, "One exception, for blocked
// containers".
//
//   node scripts/shadcn-offline.ts add input-group --overwrite --yes
//   node scripts/shadcn-offline.ts --ref <git ref> add input-group --overwrite --yes
//
// The site builds each style's components from shared sources by applying that
// style's tokens (apps/v4/scripts/build-registry.mts). This does the same build
// for the style in components.json, with the installed shadcn package's own
// transforms, then serves the result and points the CLI at it through
// REGISTRY_URL. The CLI does all the writing, so the result is what
// `shadcn add` writes from a machine with access.
//
// Source files from the shadcn repository are read as data. Registry listings
// are TypeScript array literals, read through the TypeScript parser rather
// than run.

import { spawn, spawnSync, type SpawnSyncOptions } from 'child_process'
import { promises as fs } from 'fs'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import path from 'path'
import ts from 'typescript'
import { createStyleMap, transformStyle } from 'shadcn/utils'

const ROOT = path.resolve(import.meta.dirname, '..')
const CLI = path.join(ROOT, 'node_modules/shadcn/dist/index.js')
const REPO = 'https://github.com/shadcn-ui/ui.git'

const argv = process.argv.slice(2)
let ref = 'main'
if (argv[0] === '--ref') {
  ref = argv[1]
  argv.splice(0, 2)
}
if (argv.length === 0) {
  console.error('Usage: node scripts/shadcn-offline.ts [--ref <git ref>] <shadcn arguments>')
  process.exit(1)
}

const components = JSON.parse(await fs.readFile(path.join(ROOT, 'components.json'), 'utf8'))
const [base, styleName] = components.style.split('-')
if (!styleName) {
  throw new Error(`components.json style "${components.style}" is not a <base>-<style> pair`)
}

const work = path.join(tmpdir(), 'arborist-shadcn-offline')
const source = path.join(work, 'ui')
const v4 = path.join(source, 'apps/v4')

function run(file: string, args: string[], options: SpawnSyncOptions = {}): void {
  const result = spawnSync(file, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) throw new Error(`${file} ${args.join(' ')} exited ${result.status}`)
}

// A sparse, blobless clone: only the files the build reads are downloaded.
await fs.rm(work, { recursive: true, force: true })
await fs.mkdir(work, { recursive: true })
run('git', [
  'clone',
  '--depth',
  '1',
  '--filter=blob:none',
  '--no-checkout',
  '--branch',
  ref,
  REPO,
  source
])
run(
  'git',
  [
    'sparse-checkout',
    'set',
    '--no-cone',
    `/apps/v4/registry/bases/${base}/ui/`,
    `/apps/v4/registry/bases/${base}/lib/`,
    `/apps/v4/registry/bases/${base}/hooks/`,
    `/apps/v4/registry/styles/style-${styleName}.css`,
    '/apps/v4/public/r/index.json',
    '/apps/v4/public/r/config.json',
    '/apps/v4/public/r/colors/'
  ],
  { cwd: source }
)
run('git', ['checkout'], { cwd: source })

interface RegistryFile {
  path: string
  type: string
}

interface RegistryItem {
  name: string
  dependencies?: string[]
  files?: RegistryFile[]
  [key: string]: unknown
}

type Literal = string | number | boolean | Literal[] | { [key: string]: Literal }

/** The array literal exported as `name` from a `_registry.ts` file, as JSON. */
async function readRegistryItems(file: string, name: string): Promise<RegistryItem[]> {
  const sourceFile = ts.createSourceFile(
    file,
    await fs.readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const literal = (node: ts.Node): Literal => {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(
        node.properties.map((property) => {
          if (!ts.isPropertyAssignment(property)) {
            throw new Error(`${file}: not a plain literal: ${property.getText()}`)
          }
          const key = ts.isIdentifier(property.name)
            ? property.name.text
            : String(literal(property.name))
          return [key, literal(property.initializer)]
        })
      )
    }
    throw new Error(`${file}: not a plain literal: ${node.getText().slice(0, 80)}`)
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText() === name && declaration.initializer) {
        return literal(declaration.initializer) as unknown as RegistryItem[]
      }
    }
  }
  throw new Error(`${file}: no export named ${name}`)
}

// buildBases and buildRegistryJsonFile in build-registry.mts, for one style.
const baseDir = path.join(v4, 'registry/bases', base)
const build = path.join(work, 'build')
const style = `${base}-${styleName}`
const styleMap = createStyleMap(
  await fs.readFile(path.join(v4, `registry/styles/style-${styleName}.css`), 'utf8')
)

const items: RegistryItem[] = []
for (const group of ['ui', 'lib', 'hooks']) {
  for (const item of await readRegistryItems(path.join(baseDir, group, '_registry.ts'), group)) {
    const files: RegistryFile[] = []
    let importsCn = false
    for (const file of item.files ?? []) {
      let content = await fs.readFile(path.join(baseDir, file.path), 'utf8')
      if (/\.tsx?$/.test(file.path)) content = await transformStyle(content, { styleMap })
      content = content.replaceAll(`@/registry/bases/${base}/`, `@/registry/${style}/`)
      if (/from ["']cn["']/.test(content)) importsCn = true
      const out = `registry/${style}/${file.path}`
      await fs.mkdir(path.dirname(path.join(build, out)), { recursive: true })
      await fs.writeFile(path.join(build, out), content)
      files.push({ ...file, path: out })
    }
    // getItemDependencies: an item whose files import cn declares the package.
    let dependencies = item.dependencies
    if (importsCn && !(dependencies ?? []).includes('cn'))
      dependencies = ['cn', ...(dependencies ?? [])]
    items.push({ ...item, files, ...(dependencies && { dependencies }) })
  }
}

const registryPath = path.join(build, `registry-${style}.json`)
await fs.writeFile(
  registryPath,
  JSON.stringify({ name: 'shadcn/ui', homepage: 'https://ui.shadcn.com', items })
)
const served = path.join(build, 'public')
run('node', [CLI, 'build', registryPath, '--output', path.join(served, 'r/styles', style)], {
  cwd: build
})

// The rest of what the CLI asks for along the way, from the site's own files.
await fs.cp(path.join(v4, 'public/r'), path.join(served, 'r'), { recursive: true })
await fs.writeFile(
  path.join(served, 'r/styles/index.json'),
  JSON.stringify([
    { name: 'new-york', label: 'New York' },
    { name: 'default', label: 'Default' }
  ])
)

const server = createServer(async (request, response) => {
  const file = path.join(served, new URL(request.url ?? '/', 'http://localhost').pathname)
  try {
    const body = await fs.readFile(file)
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(body)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const registryUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/r`

const code = await new Promise<number | null>((resolve) => {
  const child = spawn('node', [CLI, ...argv], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, REGISTRY_URL: registryUrl }
  })
  child.on('close', resolve)
})
server.close()
process.exit(code ?? 1)
