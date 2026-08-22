import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus, UpdateSupport } from '../../shared/updates'

/** Six hours: often enough to catch a release the same day, rarely enough to ignore. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdateServiceDeps {
  updater: AppUpdater
  /** Pushed to the renderer on every transition. */
  emit: (status: UpdateStatus) => void
  currentVersion: string
  /**
   * False for a dev run or an unpacked build, where electron-updater has no
   * install path. The service then reports "unsupported" rather than
   * throwing, so the menu item can say something honest.
   */
  supported: boolean
  now?: () => Date
  setInterval?: (handler: () => void, ms: number) => unknown
  /**
   * Starts the service in a state it would otherwise take a real release to
   * reach. Screenshot scenarios and e2e tests need the update toasts, and the
   * only other way to get one is to publish a version.
   */
  initialStatus?: UpdateStatus
}

/**
 * Wraps electron-updater in the small state machine the UI needs, and in the
 * one policy decision worth stating out loud: nothing here ever restarts the
 * app. A downloaded update sits staged until the user asks for it, or until
 * they quit of their own accord. Someone mid-`npm install` losing the run to
 * an update they never agreed to would be right to be annoyed.
 */
export class UpdateService {
  #deps: UpdateServiceDeps
  #status: UpdateStatus = { phase: 'idle' }
  /** True while the check came from the menu, so a null result is worth a word. */
  #manual = false
  #quitting = false

  constructor(deps: UpdateServiceDeps) {
    this.#deps = deps
    if (deps.initialStatus) this.#status = deps.initialStatus
    if (deps.supported) this.#wire()
  }

  get status(): UpdateStatus {
    return this.#status
  }

  support(): UpdateSupport {
    return { supported: this.#deps.supported, currentVersion: this.#deps.currentVersion }
  }

  /** An update downloaded but not applied is installed on the next ordinary quit. */
  get hasStagedUpdate(): boolean {
    return this.#status.phase === 'ready'
  }

  #set(status: UpdateStatus): void {
    this.#status = status
    this.#deps.emit(status)
  }

  #wire(): void {
    const { updater } = this.#deps
    // The toast is the notification; electron-updater's own dialog would be a
    // second one, and it is the one that offers to restart.
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true

    updater.on('checking-for-update', () => this.#set({ phase: 'checking' }))
    updater.on('update-not-available', () => {
      this.#set({
        phase: 'up-to-date',
        checkedAt: (this.#deps.now ?? (() => new Date()))().toISOString(),
        manual: this.#manual
      })
      this.#manual = false
    })
    updater.on('update-available', (info) => {
      this.#set({ phase: 'available', version: info.version })
      this.#manual = false
    })
    updater.on('download-progress', (progress) => {
      const version = 'version' in this.#status ? this.#status.version : ''
      this.#set({ phase: 'downloading', version, percent: Math.round(progress.percent) })
    })
    updater.on('update-downloaded', (info) => this.#set({ phase: 'ready', version: info.version }))
    updater.on('error', (error) => {
      // A failed check is not worth interrupting anyone over — the network
      // being down is the usual cause — so only a check they asked for
      // surfaces. The renderer decides that from `manual`.
      this.#set({ phase: 'error', message: error.message, manual: this.#manual })
      this.#manual = false
    })
  }

  /** Checks now, and every six hours after. Call once, at startup. */
  start(): void {
    if (!this.#deps.supported) return
    void this.check(false)
    const schedule = this.#deps.setInterval ?? setInterval
    schedule(() => void this.check(false), CHECK_INTERVAL_MS)
  }

  async check(manual: boolean): Promise<UpdateStatus> {
    // A staged update is the answer to "check for updates"; re-checking would
    // throw the ready state away and download the same file again.
    if (this.#status.phase === 'ready') {
      this.#deps.emit(this.#status)
      return this.#status
    }
    if (!this.#deps.supported) {
      // Nothing to check, and nothing went wrong: a dev build saying "update
      // failed" would send someone looking for a bug that isn't there.
      this.#set({ phase: 'up-to-date', checkedAt: new Date().toISOString(), manual })
      return this.#status
    }

    this.#manual = manual
    try {
      await this.#deps.updater.checkForUpdates()
    } catch (error) {
      this.#set({ phase: 'error', message: (error as Error).message, manual })
      this.#manual = false
    }
    return this.#status
  }

  /**
   * Applies a staged update. The only path that restarts the app, and it is
   * reached only from the toast's own button.
   */
  install(): void {
    if (!this.#deps.supported || this.#status.phase !== 'ready' || this.#quitting) return
    this.#quitting = true
    this.#deps.updater.quitAndInstall()
  }
}
