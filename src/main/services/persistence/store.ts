import { promises as fs } from 'fs'
import { dirname, join, basename } from 'path'
import { randomUUID } from 'crypto'
import { AppError } from '../../../shared/errors'
import { SCHEMA_VERSION, defaultData, persistedDataSchema, type PersistedData } from './schema'
import { migrate } from './migrations'

const WRITE_DEBOUNCE_MS = 500

export interface LoadResult {
  store: Store
  /** Set when the existing file was corrupt and had to be backed up. */
  warning?: string
}

/**
 * Schema-versioned JSON store with debounced atomic writes (tmp + rename).
 * A file written by a newer app version is readable but refuses writes.
 */
export class Store {
  #data: PersistedData
  #filePath: string
  #readOnlyReason: string | null
  #writeTimer: NodeJS.Timeout | null = null
  #pendingWrite: Promise<void> = Promise.resolve()

  private constructor(filePath: string, data: PersistedData, readOnlyReason: string | null) {
    this.#filePath = filePath
    this.#data = data
    this.#readOnlyReason = readOnlyReason
  }

  static async load(filePath: string): Promise<LoadResult> {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return { store: new Store(filePath, defaultData(), null) }
      }
      throw new AppError(
        `Failed to read data file: ${(error as Error).message}`,
        'store-read-failed'
      )
    }

    try {
      let parsed = JSON.parse(raw) as Record<string, unknown>
      const version = parsed.schemaVersion
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        throw new Error(`Invalid schemaVersion: ${String(version)}`)
      }
      if (version > SCHEMA_VERSION) {
        // Written by a newer app version: never validated against our older
        // schema, never renamed, and never written back — read-only.
        const attempt = persistedDataSchema.safeParse({ ...parsed, schemaVersion: SCHEMA_VERSION })
        const data = attempt.success ? attempt.data : defaultData()
        return {
          store: new Store(
            filePath,
            { ...data, schemaVersion: version },
            `Data file was written by a newer version of Arborist (schema ${version} > ${SCHEMA_VERSION}); changes will not be saved.`
          )
        }
      }
      if (version < SCHEMA_VERSION) {
        parsed = migrate(parsed, version, SCHEMA_VERSION)
      }
      const data = persistedDataSchema.parse(parsed)
      return { store: new Store(filePath, data, null) }
    } catch (error) {
      const backupPath = join(dirname(filePath), `${basename(filePath)}.corrupt-${Date.now()}.json`)
      await fs.rename(filePath, backupPath)
      return {
        store: new Store(filePath, defaultData(), null),
        warning: `Data file was corrupt (${(error as Error).message}); backed up to ${backupPath} and started fresh.`
      }
    }
  }

  get data(): Readonly<PersistedData> {
    return this.#data
  }

  get readOnlyReason(): string | null {
    return this.#readOnlyReason
  }

  /** Apply a targeted mutation and schedule a debounced atomic write. */
  mutate(fn: (data: PersistedData) => void): void {
    if (this.#readOnlyReason) {
      throw new AppError(this.#readOnlyReason, 'store-read-only')
    }
    fn(this.#data)
    this.#scheduleWrite()
  }

  /** Write any pending changes immediately. Rejects on failure — never silent. */
  async flush(): Promise<void> {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer)
      this.#writeTimer = null
      this.#pendingWrite = this.#writeNow()
    }
    await this.#pendingWrite
  }

  #scheduleWrite(): void {
    if (this.#writeTimer) clearTimeout(this.#writeTimer)
    this.#writeTimer = setTimeout(() => {
      this.#writeTimer = null
      this.#pendingWrite = this.#writeNow()
      this.#pendingWrite.catch(() => {
        // Surfaced to callers via flush(); kept here so a debounced write
        // failure does not become an unhandled rejection.
      })
    }, WRITE_DEBOUNCE_MS)
  }

  async #writeNow(): Promise<void> {
    const tmpPath = `${this.#filePath}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(dirname(this.#filePath), { recursive: true })
      await fs.writeFile(tmpPath, JSON.stringify(this.#data, null, 2), 'utf8')
      await fs.rename(tmpPath, this.#filePath)
    } catch (error) {
      await fs.rm(tmpPath, { force: true })
      throw new AppError(
        `Failed to save data file: ${(error as Error).message}`,
        'store-write-failed'
      )
    }
  }
}
