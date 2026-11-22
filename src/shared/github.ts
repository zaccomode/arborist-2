/**
 * GitHub sign-in, cloning and publishing (#150): the types both processes
 * share and the logic that can be pure. The HTTP calls and the token itself
 * stay in the main process (`src/main/services/github/`); the renderer only
 * ever sees an account, a list of repositories and the owners it can publish
 * to.
 */

/**
 * The GitHub App Arborist signs in through. A device-flow client ID is not a
 * secret: it identifies the app, it grants nothing on its own, and no client
 * secret is used. The slug is the app's public page, where people install it
 * on another account or organisation.
 */
export const GITHUB_APP_CLIENT_ID = 'Iv23lilnEniwKpzqS18B'
export const GITHUB_APP_SLUG = 'arborist-2'

export const GITHUB_WEB_URL = 'https://github.com'
export const GITHUB_API_URL = 'https://api.github.com'

/** Who Arborist is signed in as. */
export interface GitHubAccount {
  login: string
  name: string | null
}

/** An account or organisation the app is installed on, and so can publish to. */
export interface GitHubOwner {
  login: string
  type: 'User' | 'Organization'
}

export interface GitHubRepo {
  id: number
  /** `owner/name`. */
  fullName: string
  owner: string
  name: string
  private: boolean
  description: string | null
  cloneUrl: string
  sshUrl: string
}

/** The code the user types at `verificationUri` to approve the sign-in. */
export interface DeviceCode {
  userCode: string
  verificationUri: string
  /** Seconds the code stays valid for. */
  expiresIn: number
  /** The minimum gap between polls GitHub asked for, in seconds. */
  interval: number
}

export type CloneProtocol = 'https' | 'ssh'

/** Sign-in state for the renderer. Never carries the token. */
export interface GitHubStatus {
  account: GitHubAccount | null
  /**
   * False when the OS offers no keychain to encrypt the token with (some
   * Linux desktops), so a sign-in lasts until Arborist quits.
   */
  remembers: boolean
}

export interface PublishOptions {
  owner: string
  name: string
  description: string
  private: boolean
  protocol: CloneProtocol
  /** Local branches to push, each with `--set-upstream`. Empty pushes nothing. */
  branches: string[]
}

export interface PublishResult {
  fullName: string
  htmlUrl: string
}

/**
 * What one poll of the device flow's token endpoint means. GitHub answers
 * every outcome, pending included, with a 200 and a JSON body, so the body is
 * the only thing to go on.
 */
export type TokenPoll =
  | { kind: 'token'; token: string }
  | { kind: 'pending' }
  | { kind: 'slow-down'; interval: number | null }
  | { kind: 'failed'; code: string; message: string }

const POLL_FAILURES: Record<string, string> = {
  expired_token: 'The sign-in code expired before it was approved. Start again for a new one.',
  access_denied: 'The sign-in was cancelled on GitHub.',
  device_flow_disabled: 'Device sign-in is turned off for the Arborist GitHub App.',
  incorrect_client_credentials: 'GitHub did not recognise the Arborist GitHub App.',
  incorrect_device_code: 'GitHub did not recognise the sign-in code. Start again for a new one.',
  unsupported_grant_type: 'GitHub refused the sign-in request.'
}

export function interpretTokenPoll(body: unknown): TokenPoll {
  const record = (body ?? {}) as Record<string, unknown>
  if (typeof record.access_token === 'string' && record.access_token) {
    return { kind: 'token', token: record.access_token }
  }
  const error = typeof record.error === 'string' ? record.error : 'unknown'
  if (error === 'authorization_pending') return { kind: 'pending' }
  if (error === 'slow_down') {
    return {
      kind: 'slow-down',
      interval: typeof record.interval === 'number' ? record.interval : null
    }
  }
  const described = typeof record.error_description === 'string' ? record.error_description : null
  return {
    kind: 'failed',
    code: error,
    message: POLL_FAILURES[error] ?? described ?? `GitHub sign-in failed (${error}).`
  }
}

/**
 * The gap before the next poll. `slow_down` adds five seconds to the interval
 * for every later request, per RFC 8628, unless GitHub names a new one.
 */
export function nextPollInterval(current: number, poll: TokenPoll): number {
  if (poll.kind !== 'slow-down') return current
  return poll.interval ?? current + 5
}

/**
 * Repositories whose full name or description contains every word of the
 * query, case-insensitively, in their original order. An empty query keeps
 * everything.
 */
export function filterRepos(repos: readonly GitHubRepo[], query: string): GitHubRepo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...repos]
  return repos.filter((repo) => {
    const haystack = `${repo.fullName} ${repo.description ?? ''}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** Alphabetical by owner then name, with duplicates (by id) dropped. */
export function sortRepos(repos: readonly GitHubRepo[]): GitHubRepo[] {
  const seen = new Set<number>()
  const unique = repos.filter((repo) => (seen.has(repo.id) ? false : (seen.add(repo.id), true)))
  return unique.sort(
    (a, b) =>
      a.owner.localeCompare(b.owner, undefined, { sensitivity: 'base' }) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

/** Repositories grouped under their owner, keeping the order they came in. */
export function groupReposByOwner(
  repos: readonly GitHubRepo[]
): { owner: string; repos: GitHubRepo[] }[] {
  const groups = new Map<string, GitHubRepo[]>()
  for (const repo of repos) {
    const list = groups.get(repo.owner) ?? []
    list.push(repo)
    groups.set(repo.owner, list)
  }
  return [...groups].map(([owner, list]) => ({ owner, repos: list }))
}

/**
 * The signed-in account first, then organisations alphabetically, which is
 * the order the publish dialog's owner picker shows them in.
 */
export function sortOwners(owners: readonly GitHubOwner[], login: string | null): GitHubOwner[] {
  const seen = new Set<string>()
  const unique = owners.filter((owner) => {
    const key = owner.login.toLowerCase()
    return seen.has(key) ? false : (seen.add(key), true)
  })
  return unique.sort((a, b) => {
    const aSelf = a.login.toLowerCase() === login?.toLowerCase()
    const bSelf = b.login.toLowerCase() === login?.toLowerCase()
    if (aSelf !== bSelf) return aSelf ? -1 : 1
    if (a.type !== b.type) return a.type === 'User' ? -1 : 1
    return a.login.localeCompare(b.login, undefined, { sensitivity: 'base' })
  })
}

/**
 * The name GitHub will actually create: it keeps letters, digits, `.`, `-`
 * and `_`, and turns every other run of characters into one hyphen. Null when
 * nothing usable is left, or the name is one GitHub reserves.
 */
export function repoNameFor(input: string): string | null {
  const name = input
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 100)
  if (!name || name === '.' || name === '..' || /^-+$/.test(name)) return null
  return name
}

/** The URL to clone `repo` from over `protocol`. */
export function cloneUrlFor(
  repo: Pick<GitHubRepo, 'cloneUrl' | 'sshUrl'>,
  protocol: CloneProtocol
): string {
  return protocol === 'ssh' ? repo.sshUrl : repo.cloneUrl
}

/**
 * Environment variables that hand git the GitHub token for one HTTPS clone or
 * push, as an `Authorization` header scoped to that URL's origin.
 *
 * Through `GIT_CONFIG_COUNT` rather than `-c` on the command line, so the
 * token never appears in a process listing, and appended after any entries
 * the environment already carries rather than replacing them. Nothing for an
 * SSH or local URL: those authenticate (or don't) without the token.
 */
export function gitAuthEnv(
  url: string,
  token: string,
  base: Record<string, string | undefined>
): Record<string, string> {
  let origin: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return {}
    origin = parsed.origin
  } catch {
    return {}
  }
  const existing = Number.parseInt(base.GIT_CONFIG_COUNT ?? '0', 10)
  const index = Number.isFinite(existing) && existing > 0 ? existing : 0
  const credentials = btoa(`x-access-token:${token}`)
  return {
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: `http.${origin}/.extraheader`,
    [`GIT_CONFIG_VALUE_${index}`]: `Authorization: Basic ${credentials}`
  }
}

/** Where `github:openPage` can send the browser. Main resolves each to a URL. */
export type GitHubPage = 'verification' | 'install'

/** The page for installing the Arborist app on another account or organisation. */
export function installUrl(webUrl: string = GITHUB_WEB_URL): string {
  return `${webUrl}/apps/${GITHUB_APP_SLUG}/installations/new`
}
