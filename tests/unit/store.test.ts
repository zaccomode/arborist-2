import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Store } from '../../src/main/services/persistence/store'
import { SCHEMA_VERSION } from '../../src/main/services/persistence/schema'
import { migrate, type Migration } from '../../src/main/services/persistence/migrations'

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'arborist-store-'))
  filePath = join(dir, 'arborist-data.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function readFile(): Promise<Record<string, never>> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

describe('Store.load', () => {
  it('starts with default data when no file exists', async () => {
    const { store, warning } = await Store.load(filePath)

    expect(warning).toBeUndefined()
    expect(store.data.schemaVersion).toBe(SCHEMA_VERSION)
    expect(store.data.repositories).toEqual([])
    expect(store.data.settings.theme).toBe('system')
  })

  it('saves and reloads the whole shape', async () => {
    const { store } = await Store.load(filePath)
    await store.update((data) => {
      data.repositories.push({ id: 'r1', path: '/code/x', name: 'x', addedAt: '2026-01-01' })
      data.notes['r1'] = 'repository note'
      data.worktreeNotes['r1::/code/x-feature'] = 'worktree note'
      data.automationScripts.push({
        repositoryId: 'r1',
        command: 'npm install',
        runOnCreate: true
      })
      data.presets.push({
        id: 'p1',
        name: 'VS Code',
        action: { type: 'app', app: 'Visual Studio Code', args: ['{{path}}'] },
        platforms: []
      })
      data.presetConfig.hiddenBuiltInIds.push('terminal')
      data.settings.theme = 'dark'
    })

    const { store: reloaded } = await Store.load(filePath)
    expect(reloaded.data.repositories[0].name).toBe('x')
    expect(reloaded.data.notes['r1']).toBe('repository note')
    expect(reloaded.data.worktreeNotes['r1::/code/x-feature']).toBe('worktree note')
    expect(reloaded.data.automationScripts[0].runOnCreate).toBe(true)
    expect(reloaded.data.presets[0].action).toEqual({
      type: 'app',
      app: 'Visual Studio Code',
      args: ['{{path}}']
    })
    expect(reloaded.data.presetConfig.hiddenBuiltInIds).toEqual(['terminal'])
    expect(reloaded.data.settings.theme).toBe('dark')
  })

  it('migrates a schema 1 file forward', async () => {
    const v1 = { schemaVersion: 1, repositories: [{ anything: true }], settings: { loose: 'bag' } }
    await fs.writeFile(filePath, JSON.stringify(v1), 'utf8')

    const { store, warning } = await Store.load(filePath)

    expect(warning).toBeUndefined()
    expect(store.data.schemaVersion).toBe(SCHEMA_VERSION)
    expect(store.data.settings.gitPath).toBeNull()

    await store.update((data) => {
      data.notes['r1'] = 'kept'
    })
    expect((await readFile()).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('backs up a corrupt file, starts fresh, and keeps the warning available', async () => {
    await fs.writeFile(filePath, 'not json{{{', 'utf8')

    const { store, warning, backupPath } = await Store.load(filePath)
    expect(warning).toMatch(/could not read/i)
    expect(store.corruptWarning).toBe(warning)
    expect(backupPath).toMatch(/\.corrupt-/)
    expect(store.data.schemaVersion).toBe(SCHEMA_VERSION)

    const files = await fs.readdir(dir)
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true)
    expect(files).not.toContain('arborist-data.json')
  })

  it('treats a missing schemaVersion as corrupt', async () => {
    await fs.writeFile(filePath, JSON.stringify({ repositories: [] }), 'utf8')

    const { warning } = await Store.load(filePath)
    expect(warning).toMatch(/could not read/i)
  })

  it('refuses writes for a file from a newer schema version', async () => {
    const futureData = { schemaVersion: SCHEMA_VERSION + 1, repositories: [] }
    await fs.writeFile(filePath, JSON.stringify(futureData), 'utf8')

    const { store, warning } = await Store.load(filePath)
    expect(warning).toBeUndefined()
    expect(store.readOnlyReason).toMatch(/newer version/i)
    await expect(store.update(() => {})).rejects.toMatchObject({ code: 'store-read-only' })

    expect((await readFile()).schemaVersion).toBe(SCHEMA_VERSION + 1)
  })

  it('never renames a newer-version file even if its shape is unexpected', async () => {
    const futureData = { schemaVersion: SCHEMA_VERSION + 1, repositories: 'something-new' }
    await fs.writeFile(filePath, JSON.stringify(futureData), 'utf8')

    const { store } = await Store.load(filePath)
    expect(store.readOnlyReason).toMatch(/newer version/i)

    const files = await fs.readdir(dir)
    expect(files).toContain('arborist-data.json')
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(false)
  })
})

describe('Store writes', () => {
  it('writes atomically without leaving tmp files behind', async () => {
    const { store } = await Store.load(filePath)
    await store.update(() => {})

    expect(await fs.readdir(dir)).toEqual(['arborist-data.json'])
  })

  it('keeps every change when updates land inside one debounce window', async () => {
    const { store } = await Store.load(filePath)

    await Promise.all([
      store.update((data) => {
        data.notes['a'] = '1'
      }),
      store.update((data) => {
        data.notes['b'] = '2'
      }),
      store.update((data) => {
        data.notes['c'] = '3'
      })
    ])

    const { store: reloaded } = await Store.load(filePath)
    expect(reloaded.data.notes).toEqual({ a: '1', b: '2', c: '3' })
  })

  it('rejects the update that could not be saved, rather than failing silently', async () => {
    const { store } = await Store.load(filePath)
    // A directory where the data file should be: the rename has nowhere to go.
    await fs.mkdir(filePath)

    await expect(
      store.update((data) => {
        data.notes['a'] = '1'
      })
    ).rejects.toMatchObject({ code: 'store-write-failed' })
  })

  it('still saves later changes after a write failure', async () => {
    const { store } = await Store.load(filePath)
    await fs.mkdir(filePath)
    await expect(store.update((data) => void (data.notes['a'] = '1'))).rejects.toThrow()

    await fs.rmdir(filePath)
    await store.update((data) => void (data.notes['b'] = '2'))

    const { store: reloaded } = await Store.load(filePath)
    expect(reloaded.data.notes).toEqual({ a: '1', b: '2' })
  })
})

describe('migrate', () => {
  it('applies each step in order across a chain', () => {
    const registry: Record<number, Migration> = {
      1: (data) => ({ ...data, one: true }),
      2: (data) => ({ ...data, two: true })
    }

    expect(migrate({ schemaVersion: 1 }, 1, 3, registry)).toEqual({
      schemaVersion: 3,
      one: true,
      two: true
    })
  })

  it('refuses to skip a version with no migration registered', () => {
    expect(() => migrate({ schemaVersion: 1 }, 1, 3, { 1: (data) => data })).toThrow(
      /schema version 2/
    )
  })
})
