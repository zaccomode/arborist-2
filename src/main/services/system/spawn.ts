import { AppError } from '../../../shared/errors'

/**
 * Spawn failures that say "this machine could not start a process just now"
 * rather than "there is nothing here to run": the file-descriptor and
 * process-table exhaustion errnos.
 *
 * `EBADF` is the awkward one, and the reason this list exists at all (#75,
 * #83). `ChildProcess.prototype.spawn` routes `EACCES`, `EAGAIN`, `EMFILE`,
 * `ENFILE` and `ENOENT` through an asynchronous error event; every other
 * errno — `EBADF` among them — is thrown *synchronously*, out of the
 * `spawn`/`execFile` call itself, so a caller that only handles the error
 * event never types it and the raw `spawn EBADF` reaches the renderer.
 */
const TRANSIENT_SPAWN_CODES: readonly string[] = ['EBADF', 'EMFILE', 'ENFILE', 'EAGAIN']

/** How long to wait before the single retry a transient spawn failure gets. */
export const SPAWN_RETRY_DELAY_MS = 150

/**
 * What the user can actually do about a transient spawn failure, appended to
 * whichever launch failed. Watching a large monorepo holds thousands of
 * descriptors open (see `MAX_WATCHED_DIRECTORIES`), and a refresh over it
 * asks for a burst of git processes on top — enough, on a machine whose
 * limit is low enough, to run the app out mid-spawn.
 */
export const OUT_OF_RESOURCES_ADVICE =
  'This machine is out of file descriptors or processes — close some applications and try again.'

/**
 * Whether a spawn failure is one worth trying again. Exported for its own
 * test: the condition it describes is a machine-wide resource state, which a
 * test can't provoke on demand without also destabilising the runner.
 */
export function isTransientSpawnCode(code: unknown): boolean {
  return typeof code === 'string' && TRANSIENT_SPAWN_CODES.includes(code)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Runs `attempt`, and runs it once more after a short pause if it rejected
 * with an `AppError` carrying `code` — the code its caller reserves for a
 * `TRANSIENT_SPAWN_CODES` failure.
 *
 * One retry rather than a backoff loop: the burst that exhausted the
 * descriptors is usually the app's own refresh, so the pause is enough for
 * the sibling processes to exit and hand theirs back, and a machine that
 * still cannot spawn after that has a problem no amount of waiting here will
 * fix. The second failure propagates and is reported.
 */
export async function retryTransientSpawn<T>(code: string, attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt()
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== code) throw error
    await delay(SPAWN_RETRY_DELAY_MS)
    return attempt()
  }
}
