import { promises as fs } from 'fs'
import { dirname, join, basename } from 'path'
import { randomUUID } from 'crypto'
import { AppError } from '../../../shared/errors'
import {
  SCHEMA_VERSION,
  defaultData,
  persistedDataSchema,
  type PersistedData
} from '../../../shared/persisted'
import { migrate } from './migrations'

const WRITE_DEBOUNCE_MS = 250

export interface LoadResult {
  store: Store
  /** Set when the existing file was corrupt and had to be backed up. */
  warning?: string
  /** Where the unreadable file went, for the log rather than the toast. */
  backupPath?: string
}

interface Batch {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

function deferred(): Batch {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Schema-versioned JSON store with debounced atomic writes (tmp + rename).
 *
 * Every failure is loud. v1 swallowed them into a print, so a user whose
 * notes had stopped saving had no way to know: `update` resolves only once
 * the change is on disk, and rejects with the reason if it never gets there.
 *
 * A file written by a newer app version is readable but refuses writes,
 * rather than being clobbered with fields its schema no longer has.
 */
export class Store {
  #data: PersistedData
  #filePath: string
  #readOnlyReason: string | null
  #corruptWarning: string | null
  #writeTimer: NodeJS.Timeout | null = null
  #batch: Batch | null = null
  /** Serialises writes, so two saves can never interleave their renames. */
  #queue: Promise<void> = Promise.resolve()

  private constructor(
    filePath: string,
    data: PersistedData,
    readOnlyReason: string | null,
    corruptWarning: string | null = null
  ) {
    this.#filePath = filePath
    this.#data = data
    this.#readOnlyReason = readOnlyReason
    this.#corruptWarning = corruptWarning
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
      // The message is deliberately free of the backup's timestamped path: it
      // is for a toast, and the path belongs in the log next to the parse
      // error that caused all this.
      const warning =
        'Arborist could not read its saved data, so it has been backed up and a new file started. Any projects, notes and presets it held are gone.'
      console.warn(`Data file unreadable (${(error as Error).message}); backed up to ${backupPath}`)
      return { store: new Store(filePath, defaultData(), null, warning), warning, backupPath }
    }
  }

  get data(): Readonly<PersistedData> {
    return this.#data
  }

  get readOnlyReason(): string | null {
    return this.#readOnlyReason
  }

  get corruptWarning(): string | null {
    return this.#corruptWarning
  }

  /**
   * Applies a targeted mutation and resolves once it is on disk. Calls made
   * inside one debounce window share a save, and all of them see its outcome.
   */
  update(fn: (data: PersistedData) => void): Promise<void> {
    if (this.#readOnlyReason) {
      return Promise.reject(new AppError(this.#readOnlyReason, 'store-read-only'))
    }
    fn(this.#data)
    return this.#scheduleWrite()
  }

  /** Writes any pending change immediately. Rejects on failure — never silent. */
  async flush(): Promise<void> {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer)
      this.#writeTimer = null
      this.#runBatch()
    }
    await this.#queue
  }

  #scheduleWrite(): Promise<void> {
    this.#batch ??= deferred()
    const batch = this.#batch
    if (this.#writeTimer) clearTimeout(this.#writeTimer)
    this.#writeTimer = setTimeout(() => {
      this.#writeTimer = null
      this.#runBatch()
    }, WRITE_DEBOUNCE_MS)
    return batch.promise
  }

  #runBatch(): void {
    const batch = this.#batch
    if (!batch) return
    this.#batch = null

    this.#queue = this.#queue.then(() =>
      this.#writeNow().then(batch.resolve, (error: unknown) => {
        batch.reject(error)
        // The failure belongs to the caller that asked for the write, and it
        // has it; the queue stays healthy so later writes can still succeed.
      })
    )
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
