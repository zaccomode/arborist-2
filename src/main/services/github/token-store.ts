import { promises as fs } from 'fs'
import { dirname } from 'path'

/** What the token store needs from Electron's `safeStorage`, so tests can stand in for it. */
export interface Encryptor {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * Where the GitHub token lives: a file of its own beside the data file,
 * encrypted with the OS keychain (Keychain on macOS, DPAPI on Windows,
 * libsecret on Linux) — never in `arborist-data.json`, which people copy
 * between machines and attach to bug reports.
 *
 * Where no keychain is available the token is held in memory only, so a
 * sign-in lasts until Arborist quits rather than being written out in a form
 * anyone could read.
 */
export class TokenStore {
  readonly #filePath: string | null
  readonly #encryptor: Encryptor | null
  #memory: string | null = null

  /** `filePath` null keeps the token in memory only, as the scenarios' fake does. */
  constructor(filePath: string | null, encryptor: Encryptor | null) {
    this.#filePath = filePath
    this.#encryptor = encryptor
  }

  get remembers(): boolean {
    return !!this.#filePath && !!this.#encryptor?.isEncryptionAvailable()
  }

  async read(): Promise<string | null> {
    if (this.#memory) return this.#memory
    if (!this.remembers) return null
    try {
      const encrypted = await fs.readFile(this.#filePath!)
      this.#memory = this.#encryptor!.decryptString(encrypted) || null
    } catch {
      // Missing is signed out. Unreadable (a keychain that changed under it)
      // is signed out too: there is nothing to recover, only to sign in again.
      this.#memory = null
    }
    return this.#memory
  }

  async write(token: string): Promise<void> {
    this.#memory = token
    if (!this.remembers) return
    await fs.mkdir(dirname(this.#filePath!), { recursive: true })
    await fs.writeFile(this.#filePath!, this.#encryptor!.encryptString(token), { mode: 0o600 })
  }

  async clear(): Promise<void> {
    this.#memory = null
    if (this.#filePath) await fs.rm(this.#filePath, { force: true })
  }
}
