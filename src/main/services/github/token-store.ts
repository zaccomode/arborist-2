import { promises as fs } from 'fs'
import { dirname } from 'path'
import {
  parseCredentials,
  serializeCredentials,
  type GitHubCredentials
} from '../../../shared/github'

/** What the token store needs from Electron's `safeStorage`, so tests can stand in for it. */
export interface Encryptor {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /**
   * Linux only in Electron. `basic_text` means no secret service was found
   * and "encryption" is a hard-coded key, which `isEncryptionAvailable`
   * still reports as available.
   */
  getSelectedStorageBackend?(): string
}

/**
 * Where the GitHub credentials live: a file of their own beside the data
 * file, encrypted with the OS keychain (Keychain on macOS, DPAPI on Windows,
 * libsecret on Linux) — never in `arborist-data.json`, which people copy
 * between machines and attach to bug reports.
 *
 * Where no keychain is available they are held in memory only, so a sign-in
 * lasts until Arborist quits rather than being written out in a form anyone
 * could read.
 */
export class TokenStore {
  readonly #filePath: string | null
  readonly #encryptor: Encryptor | null
  #memory: GitHubCredentials | null = null

  /** `filePath` null keeps the token in memory only, as the scenarios' fake does. */
  constructor(filePath: string | null, encryptor: Encryptor | null) {
    this.#filePath = filePath
    this.#encryptor = encryptor
  }

  get remembers(): boolean {
    return (
      !!this.#filePath && !!this.#encryptor?.isEncryptionAvailable() && !this.#plaintextBackend()
    )
  }

  async read(): Promise<GitHubCredentials | null> {
    if (this.#memory) return this.#memory
    if (!this.remembers) return null
    try {
      const encrypted = await fs.readFile(this.#filePath!)
      this.#memory = parseCredentials(this.#encryptor!.decryptString(encrypted))
    } catch {
      // Missing is signed out. Unreadable (a keychain that changed under it)
      // is signed out too: there is nothing to recover, only to sign in again.
      this.#memory = null
    }
    return this.#memory
  }

  /**
   * Writes to disk before memory (#175), so a failed write leaves the store
   * as it was rather than holding a sign-in that the error just said failed.
   */
  async write(credentials: GitHubCredentials): Promise<void> {
    if (this.remembers) {
      await fs.mkdir(dirname(this.#filePath!), { recursive: true })
      await fs.writeFile(
        this.#filePath!,
        this.#encryptor!.encryptString(serializeCredentials(credentials)),
        { mode: 0o600 }
      )
    }
    this.#memory = credentials
  }

  async clear(): Promise<void> {
    this.#memory = null
    if (this.#filePath) await fs.rm(this.#filePath, { force: true })
  }

  #plaintextBackend(): boolean {
    try {
      return this.#encryptor?.getSelectedStorageBackend?.() === 'basic_text'
    } catch {
      return false
    }
  }
}
