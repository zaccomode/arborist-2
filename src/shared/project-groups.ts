/**
 * The project switcher's groups (#150): projects published to GitHub under
 * their owner, projects on another host under their owner there too (GitLab,
 * Bitbucket, Gitea and a self-hosted GitHub all have `/<owner>/<repo>`
 * paths), a host whose URLs carry no owner under the host's name, and
 * everything with no remote under "Local".
 *
 * Read from each project's remote URL, so it needs no sign-in. Kept pure so
 * the URL parsing and the grouping rules are tested directly.
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
 * Where a remote URL points, in each form git accepts for a network remote:
 * `https://host/owner/repo.git`, `ssh://git@host:22/owner/repo`, and the
 * scp-like `git@host:owner/repo.git`. Null for a local path or a `file://`
 * URL, which is a remote in git's eyes but not a published repository.
 */
export function parseRemoteUrl(url: string): RemoteLocation | null {
  const trimmed = url.trim()
  if (trimmed.length === 0) return null

  let host: string
  let path: string
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed)
  if (scheme) {
    if (scheme[1]!.toLowerCase() === 'file') return null
    const rest = scheme[2]!
    const slash = rest.indexOf('/')
    const authority = slash === -1 ? rest : rest.slice(0, slash)
    path = slash === -1 ? '' : rest.slice(slash + 1)
    host = authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d*$/, '')
  } else {
    // scp-like: `[user@]host:path`, which git only recognises when there is
    // no slash before the colon. `C:\repo` is a Windows path, not host `C`.
    const scp = /^(?:[^@/:]+@)?([^/:]+):(?!\\)(.+)$/.exec(trimmed)
    if (!scp || /^[a-z]$/i.test(scp[1]!)) return null
    host = scp[1]!
    path = scp[2]!
  }

  host = host.toLowerCase()
  if (host.length === 0) return null
  const segments = path.split('/').filter((segment) => segment.length > 0)
  // `owner/repo` has an owner; a bare `repo.git` at the root does not.
  const owner = segments.length >= 2 ? segments[0]! : null
  return { host, owner }
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
 * Projects under their headings, given each one's remote URL by id (null
 * when it has none). Groups go alphabetically with "Local" last, and each
 * group keeps the switcher's alphabetical order (#153). Owner names compare
 * case-insensitively, as GitHub treats them.
 */
export function groupProjects(
  projects: readonly Repository[],
  remoteUrls: Readonly<Record<string, string | null>>
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  for (const project of sortProjects(projects)) {
    const url = remoteUrls[project.id] ?? null
    const location = url ? parseRemoteUrl(url) : null
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
 * The URL to group a repository by, from `git config --get-regexp
 * '^remote\..*\.url$'` output: `origin`'s, since that is where a clone came
 * from and where a publish goes, else the first remote's.
 */
export function pickRemoteUrl(configOutput: string): string | null {
  const remotes: { name: string; url: string }[] = []
  for (const line of configOutput.split(/\r?\n/)) {
    const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim())
    if (match) remotes.push({ name: match[1]!, url: match[2]! })
  }
  return (remotes.find((remote) => remote.name === 'origin') ?? remotes[0])?.url ?? null
}
