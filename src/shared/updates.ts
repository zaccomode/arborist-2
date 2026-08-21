/**
 * The update lifecycle, as the renderer sees it.
 *
 * Deliberately smaller than electron-updater's own event surface: the UI only
 * has to answer "is there anything to say to the user right now", and every
 * additional state is another thing to get wrong in a toast.
 */
export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  /** A check that found nothing. `manual` is what earns a "you're up to date". */
  | { phase: 'up-to-date'; checkedAt: string; manual: boolean }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  /** Downloaded and staged. Applying it is the user's call, never ours. */
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string; manual: boolean }

/**
 * Whether this build can update itself at all. A dev run and an unpacked
 * build cannot, and telling someone an update is available when the app has
 * no way to install it is worse than saying nothing.
 */
export interface UpdateSupport {
  supported: boolean
  currentVersion: string
}
