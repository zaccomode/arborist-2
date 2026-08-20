import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Store } from '../../src/main/services/persistence/store'
import { SCHEMA_VERSION } from '../../src/main/services/persistence/schema'

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'arborist-store-'))
  filePath = join(dir, 'arborist-data.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('Store.load', () => {
  it('starts with default data when no file exists', async () => {
    const { store, warning } = await Store.load(filePath)
    expect(warning).toBeUndefined()
    expect(store.data.schemaVersion).toBe(SCHEMA_VERSION)
    expect(store.data.repositories).toEqual([])
  })

  it('saves and reloads schemaVersion 1 data', async () => {
    const { store } = await Store.load(filePath)
    store.mutate((data) => {
      data.settings['theme'] = 'dark'
    })
    await store.flush()

    const written = JSON.parse(await fs.readFile(filePath, 'utf8'))
    expect(written.schemaVersion).toBe(1)

    const { store: reloaded } = await Store.load(filePath)
    expect(reloaded.data.schemaVersion).toBe(1)
    expect(reloaded.data.settings['theme']).toBe('dark')
  })

  it('backs up a corrupt file and starts fresh with a warning', async () => {
    await fs.writeFile(filePath, 'not json{{{', 'utf8')

    const { store, warning } = await Store.load(filePath)
    expect(warning).toMatch(/corrupt/i)
    expect(store.data.schemaVersion).toBe(SCHEMA_VERSION)

    const files = await fs.readdir(dir)
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true)
    expect(files).not.toContain('arborist-data.json')
  })

  it('treats a missing schemaVersion as corrupt', async () => {
    await fs.writeFile(filePath, JSON.stringify({ repositories: [] }), 'utf8')

    const { warning } = await Store.load(filePath)
    expect(warning).toMatch(/corrupt/i)
  })

  it('refuses writes for a file from a newer schema version', async () => {
    const futureData = { schemaVersion: SCHEMA_VERSION + 1, repositories: [], settings: {} }
    await fs.writeFile(filePath, JSON.stringify(futureData), 'utf8')

    const { store, warning } = await Store.load(filePath)
    expect(warning).toBeUndefined()
    expect(store.readOnlyReason).toMatch(/newer version/i)
    expect(() => store.mutate(() => {})).toThrow(/newer version/i)

    // The original file must be untouched.
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8'))
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION + 1)
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

  it('writes atomically without leaving tmp files behind', async () => {
    const { store } = await Store.load(filePath)
    store.mutate(() => {})
    await store.flush()

    const files = await fs.readdir(dir)
    expect(files).toEqual(['arborist-data.json'])
  })
})
