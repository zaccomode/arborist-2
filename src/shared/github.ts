import type { Repository } from './persisted'
import { parseRemoteUrl, type RemoteLocation } from './project-groups'

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
  /** The repository's page, which is also what identifies it against a project's remote. */
  htmlUrl: string
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
  | {
      kind: 'token'
      token: string
      /** Seconds the token lasts. Absent for a token that never expires. */
      expiresIn?: number
      /** For swapping an expiring token for a new one without the device flow again. */
      refreshToken?: string
      /** Seconds the refresh token lasts. */
      refreshTokenExpiresIn?: number
    }
  | { kind: 'pending' }
  | { kind: 'slow-down'; interval: number | null }
  | { kind: 'failed'; code: string; message: string }

const POLL_FAILURES: Record<string, string> = {
  expired_token: 'The sign-in code expired before it was approved. Start again for a new one.',
  access_denied: 'The sign-in was cancelled on GitHub.',
  device_flow_disabled: 'Device sign-in is turned off for the Arborist GitHub App.',
  incorrect_client_credentials: 'GitHub did not recognise the Arborist GitHub App.',
  incorrect_device_code: 'GitHub did not recognise the sign-in code. Start again for a new one.',
  unsupported_grant_type: 'GitHub refused the sign-in request.',
  bad_refresh_token: 'GitHub no longer accepts this sign-in. Sign in again to continue.'
}

/**
 * Reads the token endpoint's answer, to a device-flow poll or to a refresh
 * (#174). A GitHub App with "Expire user authorization tokens" turned on (the
 * default) issues tokens that last eight hours, with a refresh token that
 * lasts six months; one with it off issues a token that never expires and no
 * refresh token. Both are handled, so the app's setting can change without a
 * release: the expiry fields are kept when GitHub sends them, and their
 * absence means the token lasts until it is revoked.
 */
export function interpretTokenPoll(body: unknown): TokenPoll {
  const record = (body ?? {}) as Record<string, unknown>
  if (typeof record.access_token === 'string' && record.access_token) {
    const seconds = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
    const expiresIn = seconds(record.expires_in)
    const refreshTokenExpiresIn = seconds(record.refresh_token_expires_in)
    const refreshToken =
      typeof record.refresh_token === 'string' && record.refresh_token
        ? record.refresh_token
        : undefined
    return {
      kind: 'token',
      token: record.access_token,
      ...(expiresIn !== undefined ? { expiresIn } : {}),
      ...(refreshToken !== undefined ? { refreshToken } : {}),
      ...(refreshTokenExpiresIn !== undefined ? { refreshTokenExpiresIn } : {})
    }
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
 * What the token store keeps (#174): the access token, and, when GitHub
 * issued an expiring one, what is needed to replace it. Times are epoch
 * milliseconds; null means "doesn't expire" or "there isn't one".
 */
export interface GitHubCredentials {
  accessToken: string
  expiresAt: number | null
  refreshToken: string | null
  refreshExpiresAt: number | null
}

/**
 * How long before its expiry a token is refreshed, so a call made just
 * before the deadline isn't refused on its way to GitHub.
 */
export const REFRESH_MARGIN_MS = 5 * 60_000

/** The credentials a token answer amounts to, as of `now`. */
export function credentialsFrom(
  poll: Extract<TokenPoll, { kind: 'token' }>,
  now: number
): GitHubCredentials {
  return {
    accessToken: poll.token,
    expiresAt: poll.expiresIn !== undefined ? now + poll.expiresIn * 1000 : null,
    refreshToken: poll.refreshToken ?? null,
    refreshExpiresAt:
      poll.refreshToken !== undefined && poll.refreshTokenExpiresIn !== undefined
        ? now + poll.refreshTokenExpiresIn * 1000
        : null
  }
}

/** Credentials for a token that never expires. */
export function lastingCredentials(accessToken: string): GitHubCredentials {
  return { accessToken, expiresAt: null, refreshToken: null, refreshExpiresAt: null }
}

/** Whether the access token has expired, or is close enough to it to replace now. */
export function refreshDue(credentials: GitHubCredentials, now: number): boolean {
  return credentials.expiresAt !== null && now >= credentials.expiresAt - REFRESH_MARGIN_MS
}

/** Whether there is a refresh token, and it hasn't expired itself. */
export function canRefresh(credentials: GitHubCredentials, now: number): boolean {
  return (
    credentials.refreshToken !== null &&
    (credentials.refreshExpiresAt === null || now < credentials.refreshExpiresAt)
  )
}

/**
 * Whether a refresh that didn't produce a token means the sign-in is over
 * (#178): GitHub refused the refresh token itself. Anything else, such as an
 * outage's empty body or a rate limit, says nothing about the refresh token,
 * which stays good for months, so signing out over it would only send the
 * user through the device flow again for nothing.
 */
export function refreshRefused(poll: TokenPoll): boolean {
  return (
    poll.kind === 'failed' && (poll.code === 'bad_refresh_token' || poll.code === 'invalid_grant')
  )
}

/**
 * Whether git's stderr says the remote refused the credentials it was given
 * or what they allowed (#179): a 401 or 403, git's own "authentication
 * failed", or GitHub turning down a push that an app's token isn't allowed
 * to make, such as one touching `.github/workflows/` without the Workflows
 * permission, or any push with read-only Contents.
 *
 * Used to retry a fetch, pull or push once without Arborist's GitHub token,
 * so the user's own credentials get their turn. A wrong guess costs at most
 * one extra git call, or the error the user would have seen anyway: a
 * refusal leaves nothing half-done to repeat, since git stops before it
 * merges or updates any ref.
 */
export function remoteRefusedCredentials(stderr: string): boolean {
  return /authentication failed|returned error: 40[13]|permission to \S+ denied|refusing to allow an? (?:GitHub|OAuth) App|could not read username|terminal prompts disabled/i.test(
    stderr
  )
}

export function serializeCredentials(credentials: GitHubCredentials): string {
  return JSON.stringify(credentials)
}

/**
 * Reads what `serializeCredentials` wrote. Anything that isn't that JSON is
 * taken as a bare access token, which is how 3.12 and earlier stored it, so
 * an existing sign-in survives the upgrade. Null for nothing usable.
 */
export function parseCredentials(text: string): GitHubCredentials | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('{')) return lastingCredentials(trimmed)
  try {
    const record = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof record.accessToken !== 'string' || !record.accessToken) return null
    const time = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null
    return {
      accessToken: record.accessToken,
      expiresAt: time(record.expiresAt),
      refreshToken:
        typeof record.refreshToken === 'string' && record.refreshToken ? record.refreshToken : null,
      refreshExpiresAt: time(record.refreshExpiresAt)
    }
  } catch {
    return null
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
 *
 * It does reach every process git starts with that environment, though:
 * hooks such as `pre-push`, credential helpers and LFS can all read it
 * (#174). Arborist still runs the repository's hooks, since skipping them
 * would quietly change what a push does, and a hook is code the user already
 * runs as themselves. What limits the exposure is the token itself: it can
 * do only what the Arborist GitHub App is granted, on the repositories it is
 * installed on.
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
  return authHeaderEnv([`${origin}/`], token, base)
}

/**
 * The same header for a fetch, pull or push in an existing project (#174),
 * scoped to each of `urls` exactly rather than to the whole host. git matches
 * `http.<url>.*` against the URL it is about to use, so a remote that isn't
 * listed here, including another repository on github.com, keeps whatever
 * credentials the user's own git setup gives it.
 */
export function repoAuthEnv(
  urls: readonly string[],
  token: string,
  base: Record<string, string | undefined>
): Record<string, string> {
  return authHeaderEnv([...new Set(urls)], token, base)
}

function authHeaderEnv(
  scopes: readonly string[],
  token: string,
  base: Record<string, string | undefined>
): Record<string, string> {
  if (scopes.length === 0) return {}
  const existing = Number.parseInt(base.GIT_CONFIG_COUNT ?? '0', 10)
  const first = Number.isFinite(existing) && existing > 0 ? existing : 0
  const header = `Authorization: Basic ${btoa(`x-access-token:${token}`)}`
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(first + scopes.length) }
  scopes.forEach((scope, offset) => {
    env[`GIT_CONFIG_KEY_${first + offset}`] = `http.${scope}.extraheader`
    env[`GIT_CONFIG_VALUE_${first + offset}`] = header
  })
  return env
}

/**
 * The repository an HTTPS remote URL points at on GitHub, as a lower-cased
 * `owner/name`, for deciding whether a fetch, pull or push may carry the
 * token (#174). Null for SSH and local URLs (the token is an HTTP
 * credential), for another host, for anything that isn't exactly
 * `owner/name`, and for a URL that already names a user: those come with
 * credentials of their own, which the token would override.
 */
export function githubRepoForUrl(url: string, webUrl: string = GITHUB_WEB_URL): string | null {
  let parsed: URL
  let web: URL
  try {
    parsed = new URL(url)
    web = new URL(webUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.protocol !== web.protocol) return null
  if (parsed.host.toLowerCase() !== web.host.toLowerCase()) return null
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null
  const segments = parsed.pathname
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/')
  if (segments.length !== 2 || segments.some((segment) => !segment)) return null
  return segments.join('/').toLowerCase()
}

/** Where `github:openPage` can send the browser. Main resolves each to a URL. */
export type GitHubPage = 'verification' | 'install'

/** The page for installing the Arborist app on another account or organisation. */
export function installUrl(webUrl: string = GITHUB_WEB_URL): string {
  return `${webUrl}/apps/${GITHUB_APP_SLUG}/installations/new`
}

/**
 * The project each repository is already cloned as, if any, by repository
 * id: matched on host and full name against each project's remote, ignoring
 * case and `.git`, so a project reached over SSH matches its HTTPS listing.
 * The clone dialog warns before making a second copy of one of these.
 */
export function projectsByRepo(
  repos: readonly GitHubRepo[],
  projects: readonly Repository[],
  locations: Readonly<Record<string, RemoteLocation | null>>
): Map<number, Repository> {
  const byKey = new Map<string, Repository>()
  for (const project of projects) {
    const location = locations[project.id]
    if (!location?.fullName) continue
    const key = `${location.host}/${location.fullName}`.toLowerCase()
    if (!byKey.has(key)) byKey.set(key, project)
  }
  const matches = new Map<number, Repository>()
  for (const repo of repos) {
    const location = parseRemoteUrl(repo.htmlUrl)
    if (!location?.fullName) continue
    const project = byKey.get(`${location.host}/${location.fullName}`.toLowerCase())
    if (project) matches.set(repo.id, project)
  }
  return matches
}
