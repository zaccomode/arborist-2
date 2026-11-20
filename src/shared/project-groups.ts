/**
 * The project switcher's groups (#150): projects published to GitHub under
 * their owner, projects on another host under their owner there too (GitLab,
 * Bitbucket, Gitea and a self-hosted GitHub all have `/<owner>/<repo>`
 * paths), a host whose URLs carry no owner under the host's name, and
 * everything with no remote under "Local".
 *
 * Read from each project's remote URL, so it needs no sign-in. The URL is
 * read and parsed in the main process, and only the `RemoteLocation` crosses
 * to the renderer, so credentials embedded in a URL never leave it (#166).
 * Kept pure so the URL parsing and the grouping rules are tested directly.
 */
import type { Repository } from './persisted'
import { sortProjects } from './list-view'

export interface RemoteLocation {
  /** Lower-cased, port and credentials dropped: `github.com`. */
  host: string
  /** The first path segment, or null when the path has only the repository. */
  owner: string | null
}

export const LOCAL_GROUP = 'Local'
const GITHUB = 'github.com'

/**
 * Hosts that are another way in to a better-known one: GitHub's SSH-over-443
 * endpoint is still GitHub, and its projects belong with their owner (#166).
 */
const HOST_ALIASES: Readonly<Record<string, string>> = { 'ssh.github.com': GITHUB }

function canonicalHost(host: string): string {
  const lower = host.toLowerCase()
  return HOST_ALIASES[lower] ?? lower
}

/**
 * A network remote URL split into its host, as written, and its path, and
 * whether git reaches it over SSH: the scp-like `git@host:path` or an
 * `ssh://` URL. Null for a local path, a `file://` URL, or a URL with no
 * host. The one place remote URLs are parsed, so the host looked up in
 * `~/.ssh/config` is always the host that is replaced (#168).
 */
export interface SplitRemoteUrl {
  host: string
  path: string
  ssh: boolean
}

export function splitRemoteUrl(url: string): SplitRemoteUrl | null {
  const trimmed = url.trim()
  if (trimmed.length === 0) return null

  let split: SplitRemoteUrl
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed)
  if (scheme) {
    const protocol = scheme[1]!.toLowerCase()
    if (protocol === 'file') return null
    // Credentials end at the *last* `@`: one in an unencoded password, or a
    // `/` in it, must not leak into the host or owner (#166). Owner and
    // repository names never hold an `@`, so nothing real is lost.
    const rest = scheme[2]!
    const afterUserinfo = rest.slice(rest.lastIndexOf('@') + 1)
    const slash = afterUserinfo.indexOf('/')
    const authority = slash === -1 ? afterUserinfo : afterUserinfo.slice(0, slash)
    split = {
      host: authority.replace(/:\d*$/, ''),
      path: slash === -1 ? '' : afterUserinfo.slice(slash + 1),
      ssh: /^(ssh|git\+ssh|ssh\+git)$/.test(protocol)
    }
  } else {
    const scp = scpLike(trimmed)
    if (!scp) return null
    // An absolute path on the host, `git@host:/srv/repo.git`, names a
    // directory rather than an owner.
    split = { host: scp.host, path: scp.path.startsWith('/') ? '' : scp.path, ssh: true }
  }
  return split.host.length > 0 ? split : null
}

/**
 * The host of a URL git reaches over SSH, as written. That host may be a
 * `~/.ssh/config` alias (`github-work`), which only ssh itself can resolve.
 * Null for any other kind of URL.
 */
export function sshHostOf(url: string): string | null {
  const split = splitRemoteUrl(url)
  return split?.ssh ? split.host : null
}

/** `[user@]host:path`, which git only reads as SSH with no slash before the colon. */
function scpLike(url: string): { host: string; path: string } | null {
  // `C:\repo` is a Windows path, not host `C`.
  const scp = /^(?:[^@/:]+@)?([^/:]+):(?!\\)(.+)$/.exec(url)
  if (!scp || /^[a-z]$/i.test(scp[1]!)) return null
  return { host: scp[1]!, path: scp[2]! }
}

/**
 * Whether `host` is safe to hand to `ssh -G` as its destination argument: a
 * plain host name, never something ssh could read as an option.
 */
export function isResolvableSshHost(host: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(host)
}

/** The `hostname` line of `ssh -G <host>` output, or null if it has none. */
export function parseSshHostname(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^hostname\s+(\S+)\s*$/i.exec(line)
    if (match) return match[1]!
  }
  return null
}

/**
 * Where a remote URL points, in each form git accepts for a network remote:
 * `https://host/owner/repo.git`, `ssh://git@host:22/owner/repo`, and the
 * scp-like `git@host:owner/repo.git`. Null for a local path or a `file://`
 * URL, which is a remote in git's eyes but not a published repository.
 *
 * `resolveHost` maps an SSH URL's host through `~/.ssh/config`, so an alias
 * like `github-work` lands with the real host's projects; without it the
 * host is taken as written.
 */
export function parseRemoteUrl(
  url: string,
  resolveHost: (host: string) => string = (host) => host
): RemoteLocation | null {
  const split = splitRemoteUrl(url)
  return split ? locate(split, split.ssh ? resolveHost(split.host) : split.host) : null
}

function locate(split: SplitRemoteUrl, host: string): RemoteLocation {
  const segments = split.path.split('/').filter((segment) => segment.length > 0)
  // `owner/repo` has an owner; a bare `repo.git` at the root does not.
  const owner = segments.length >= 2 ? segments[0]! : null
  return { host: canonicalHost(host), owner }
}

/**
 * `parseRemoteUrl` with the SSH host resolved first by an asynchronous
 * lookup, which is what `ssh -G` is. Only an SSH URL's host is looked up.
 */
export async function resolveRemoteLocation(
  url: string | null,
  lookupSshHost: (host: string) => Promise<string>
): Promise<RemoteLocation | null> {
  const split = url ? splitRemoteUrl(url) : null
  if (!split) return null
  return locate(split, split.ssh ? await lookupSshHost(split.host) : split.host)
}

/** The heading a project goes under. */
export function groupLabel(location: RemoteLocation | null): string {
  if (!location) return LOCAL_GROUP
  if (!location.owner) return location.host
  return location.host === GITHUB ? location.owner : `${location.owner} (${location.host})`
}

export interface ProjectGroup {
  label: string
  /** No remote: a GitHub owner who happens to be called "Local" is not this. */
  local: boolean
  projects: Repository[]
}

/**
 * Projects under their headings, given where each one is published by id
 * (null when it has no remote). Groups go alphabetically with "Local" last, and each
 * group keeps the switcher's alphabetical order (#153). Owner names compare
 * case-insensitively, as GitHub treats them.
 */
export function groupProjects(
  projects: readonly Repository[],
  locations: Readonly<Record<string, RemoteLocation | null>>
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  for (const project of sortProjects(projects)) {
    const location = locations[project.id] ?? null
    const label = groupLabel(location)
    const key = location ? `remote:${label.toLowerCase()}` : 'local'
    const group = groups.get(key) ?? { label, local: !location, projects: [] }
    group.projects.push(project)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => {
    if (a.local !== b.local) return a.local ? 1 : -1
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/**
 * The remote to group a repository by, from `git config --get-regexp
 * '^remote\..*\.url$'` output: `origin`, since that is where a clone came
 * from and where a publish goes, else the first remote. Its URL is then read
 * with `git remote get-url`, which applies `url.*.insteadOf` (#166).
 */
export function pickRemoteName(configOutput: string): string | null {
  const names: string[] = []
  for (const line of configOutput.split(/\r?\n/)) {
    const match = /^remote\.(.+)\.url\s+.+$/.exec(line.trim())
    if (match) names.push(match[1]!)
  }
  return names.includes('origin') ? 'origin' : (names[0] ?? null)
}
