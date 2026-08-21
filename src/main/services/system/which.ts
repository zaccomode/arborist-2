import { execFile } from 'child_process'

/**
 * Absolute path of `command` on PATH, or null.
 *
 * `where` on Windows, `which` elsewhere, rather than a shell builtin, so this
 * never goes near a shell.
 */
export function which(command: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(finder, [command], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const first = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)
      resolve(first ? first.trim() : null)
    })
  })
}
