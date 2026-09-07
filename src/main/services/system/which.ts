import { execFile } from 'child_process'
import { AppError } from '../../../shared/errors'
import { isTransientSpawnCode, OUT_OF_RESOURCES_ADVICE, retryTransientSpawn } from './spawn'
import { pickExecutable } from '../../../shared/which'

/** The code `which` rejects with when the machine could not start a process. */
export const WHICH_SPAWN_FAILED_CODE = 'which-spawn-failed'

/**
 * Absolute path of `command` on PATH, or null.
 *
 * `where` on Windows, `which` elsewhere, rather than a shell builtin, so this
 * never goes near a shell. `where` can list more than one match — see
 * `pickExecutable`'s doc comment for why blindly taking its first line
 * broke launching VS Code on Windows (#63).
 *
 * "Not on PATH" is a null; a machine that could not start the lookup at all
 * is a rejection (#83). The two are different answers, and collapsing them
 * told someone whose machine was out of file descriptors that VS Code was
 * not installed. A transient failure is retried once first — see
 * `retryTransientSpawn`.
 */
export function which(command: string): Promise<string | null> {
  return retryTransientSpawn(WHICH_SPAWN_FAILED_CODE, () => whichOnce(command))
}

function whichOnce(command: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve, reject) => {
    const onSettled = (error: Error | null, stdout: string): void => {
      if (error) {
        // A non-zero exit is the finder saying it found nothing, which is a
        // null. Only a failure to start the finder is a spawn failure.
        const failure = error as NodeJS.ErrnoException
        if (isTransientSpawnCode(failure.code)) {
          reject(spawnFailure(finder, failure))
          return
        }
        resolve(null)
        return
      }
      resolve(pickExecutable(stdout.split(/\r?\n/), process.platform))
    }

    // `execFile` throws, synchronously, for every spawn errno outside the
    // handful `ChildProcess.prototype.spawn` reports through the callback —
    // see `isTransientSpawnCode`. Unwrapped, that throw rejects this promise
    // with the raw error rather than the typed one.
    try {
      execFile(finder, [command], { windowsHide: true }, onSettled)
    } catch (error) {
      const failure = error as NodeJS.ErrnoException
      if (isTransientSpawnCode(failure.code)) {
        reject(spawnFailure(finder, failure))
        return
      }
      resolve(null)
    }
  })
}

function spawnFailure(finder: string, error: NodeJS.ErrnoException): AppError {
  return new AppError(
    `Could not start ${finder}: ${error.message}. ${OUT_OF_RESOURCES_ADVICE}`,
    WHICH_SPAWN_FAILED_CODE
  )
}
