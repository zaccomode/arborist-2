import { execFile } from 'child_process'
import { pickExecutable } from '../../../shared/which'

/**
 * Absolute path of `command` on PATH, or null.
 *
 * `where` on Windows, `which` elsewhere, rather than a shell builtin, so this
 * never goes near a shell. `where` can list more than one match — see
 * `pickExecutable`'s doc comment for why blindly taking its first line
 * broke launching VS Code on Windows (#63).
 */
export function which(command: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(finder, [command], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      resolve(pickExecutable(stdout.split(/\r?\n/), process.platform))
    })
  })
}
