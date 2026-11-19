import { execFile } from 'child_process'
import { isResolvableSshHost, parseSshHostname } from '../../../shared/project-groups'

/** Long enough for ssh to read its config; it never connects with `-G`. */
const SSH_CONFIG_TIMEOUT_MS = 5_000

/**
 * The real host behind an SSH host name, as `~/.ssh/config` resolves it:
 * `github-work` -> `github.com` for the common multi-account alias (#166).
 *
 * `ssh -G` prints the configuration ssh would use for a destination without
 * connecting to it. Anything that goes wrong — no ssh on PATH, a timeout, an
 * unreadable config — falls back to the host as written, which is what the
 * switcher showed before. Results are kept for the session: an alias changes
 * far less often than the switcher asks.
 */
export class SshHostResolver {
  #cache = new Map<string, Promise<string>>()

  constructor(private readonly run: (host: string) => Promise<string> = runSshG) {}

  resolve(host: string): Promise<string> {
    if (!isResolvableSshHost(host)) return Promise.resolve(host)
    let pending = this.#cache.get(host)
    if (!pending) {
      pending = this.run(host)
        .then((output) => parseSshHostname(output) ?? host)
        .catch(() => host)
      this.#cache.set(host, pending)
    }
    return pending
  }
}

function runSshG(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // `host` has passed `isResolvableSshHost`, so it can't be read as an
      // option; execFile never involves a shell.
      execFile(
        'ssh',
        ['-G', host],
        { timeout: SSH_CONFIG_TIMEOUT_MS, windowsHide: true },
        (error, stdout) => (error ? reject(error) : resolve(stdout))
      )
    } catch (error) {
      // Spawn errnos outside the handful reported through the callback are
      // thrown synchronously (see `isTransientSpawnCode`).
      reject(error)
    }
  })
}
