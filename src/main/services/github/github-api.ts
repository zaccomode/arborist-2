import { AppError } from '../../../shared/errors'
import {
  GITHUB_API_URL,
  GITHUB_APP_CLIENT_ID,
  GITHUB_WEB_URL,
  interpretTokenPoll,
  type DeviceCode,
  type GitHubAccount,
  type GitHubOwner,
  type GitHubRepo,
  type TokenPoll
} from '../../../shared/github'

/**
 * Everything Arborist asks of GitHub. The service talks to this rather than
 * to `fetch`, so screenshot scenarios and e2e tests can stand a fake in its
 * place (see `fake-github.ts`): the real device flow needs a person at a
 * browser.
 */
export interface GitHubApi {
  readonly webUrl: string
  requestDeviceCode(): Promise<DeviceCode & { deviceCode: string }>
  pollDeviceToken(deviceCode: string): Promise<TokenPoll>
  /**
   * Swaps a refresh token for a new access token and refresh token (#174).
   * The old pair stops working once this succeeds. A device-flow token needs
   * no client secret to refresh.
   */
  refreshToken(refreshToken: string): Promise<TokenPoll>
  account(token: string): Promise<GitHubAccount>
  /** The accounts and organisations the app is installed on that this user can see. */
  installations(token: string): Promise<{ id: number; owner: GitHubOwner }[]>
  installationRepos(token: string, installationId: number): Promise<GitHubRepo[]>
  createRepo(
    token: string,
    owner: { login: string; personal: boolean },
    repo: { name: string; description: string; private: boolean }
  ): Promise<GitHubRepo>
}

/** Thrown when GitHub no longer accepts the token, so the service can forget it. */
export const SIGNED_OUT_CODE = 'github-signed-out'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const PAGE_SIZE = 100
/** 5,000 repositories per installation is far past anything a picker can show usefully. */
const MAX_PAGES = 50

interface RawRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  description: string | null
  clone_url: string
  ssh_url: string
  html_url: string
}

function toRepo(raw: RawRepo): GitHubRepo {
  return {
    id: raw.id,
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    private: raw.private,
    description: raw.description,
    cloneUrl: raw.clone_url,
    sshUrl: raw.ssh_url,
    htmlUrl: raw.html_url
  }
}

/**
 * GitHub's REST API and device-flow endpoints, over whatever `fetch` it is
 * given: Electron's `net.fetch` in the app, so the system proxy applies.
 */
export class HttpGitHubApi implements GitHubApi {
  readonly webUrl: string
  readonly #apiUrl: string
  readonly #fetch: Fetch
  readonly #clientId: string

  constructor(
    fetchImpl: Fetch,
    {
      webUrl = GITHUB_WEB_URL,
      apiUrl = GITHUB_API_URL,
      clientId = GITHUB_APP_CLIENT_ID
    }: { webUrl?: string; apiUrl?: string; clientId?: string } = {}
  ) {
    this.#fetch = fetchImpl
    this.webUrl = webUrl
    this.#apiUrl = apiUrl
    this.#clientId = clientId
  }

  async requestDeviceCode(): Promise<DeviceCode & { deviceCode: string }> {
    const body = await this.#postForm('/login/device/code', { client_id: this.#clientId })
    if (typeof body.device_code !== 'string' || typeof body.user_code !== 'string') {
      const reason = typeof body.error_description === 'string' ? body.error_description : null
      throw new AppError(
        reason ?? 'GitHub did not issue a sign-in code.',
        'github-device-code-failed'
      )
    }
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri:
        typeof body.verification_uri === 'string'
          ? body.verification_uri
          : `${this.webUrl}/login/device`,
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 900,
      interval: typeof body.interval === 'number' ? body.interval : 5
    }
  }

  async pollDeviceToken(deviceCode: string): Promise<TokenPoll> {
    const body = await this.#postForm('/login/oauth/access_token', {
      client_id: this.#clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
    return interpretTokenPoll(body)
  }

  async refreshToken(refreshToken: string): Promise<TokenPoll> {
    const body = await this.#postForm('/login/oauth/access_token', {
      client_id: this.#clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
    return interpretTokenPoll(body)
  }

  async account(token: string): Promise<GitHubAccount> {
    const user = (await this.#api(token, 'GET', '/user')) as { login: string; name: string | null }
    return { login: user.login, name: user.name ?? null }
  }

  async installations(token: string): Promise<{ id: number; owner: GitHubOwner }[]> {
    const pages = await this.#paginate(token, '/user/installations', 'installations')
    return (pages as { id: number; account: { login: string; type: string } }[]).map((entry) => ({
      id: entry.id,
      owner: {
        login: entry.account.login,
        type: entry.account.type === 'Organization' ? 'Organization' : 'User'
      }
    }))
  }

  async installationRepos(token: string, installationId: number): Promise<GitHubRepo[]> {
    const pages = await this.#paginate(
      token,
      `/user/installations/${installationId}/repositories`,
      'repositories'
    )
    return (pages as RawRepo[]).map(toRepo)
  }

  async createRepo(
    token: string,
    owner: { login: string; personal: boolean },
    repo: { name: string; description: string; private: boolean }
  ): Promise<GitHubRepo> {
    const path = owner.personal ? '/user/repos' : `/orgs/${encodeURIComponent(owner.login)}/repos`
    const raw = await this.#api(token, 'POST', path, {
      name: repo.name,
      description: repo.description || undefined,
      private: repo.private
    })
    return toRepo(raw as RawRepo)
  }

  async #paginate(token: string, path: string, key: string): Promise<unknown[]> {
    const items: unknown[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = (await this.#api(
        token,
        'GET',
        `${path}?per_page=${PAGE_SIZE}&page=${page}`
      )) as Record<string, unknown>
      const batch = Array.isArray(body[key]) ? (body[key] as unknown[]) : []
      items.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }
    return items
  }

  async #api(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#apiUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })
    } catch (error) {
      throw new AppError(`Could not reach GitHub: ${(error as Error).message}`, 'github-offline')
    }
    if (response.status === 401) {
      throw new AppError('GitHub signed Arborist out. Sign in again to continue.', SIGNED_OUT_CODE)
    }
    const text = await response.text()
    let parsed: Record<string, unknown>
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      // A proxy's HTML error page, or GitHub's own during an outage (#175):
      // say what status came back rather than "Unexpected token <".
      throw new AppError(apiErrorMessage(response.status, {}), 'github-request-failed')
    }
    if (!response.ok) {
      throw new AppError(apiErrorMessage(response.status, parsed), 'github-request-failed')
    }
    return parsed
  }

  async #postForm(path: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.#fetch(`${this.webUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(fields).toString()
      })
    } catch (error) {
      throw new AppError(`Could not reach GitHub: ${(error as Error).message}`, 'github-offline')
    }
    const text = await response.text()
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      throw new AppError(
        `GitHub answered the sign-in request with HTTP ${response.status}.`,
        'github-request-failed'
      )
    }
  }
}

/**
 * GitHub's own explanation where it gives one. A 422 on creating a repository
 * carries the useful part ("name already exists on this account") in
 * `errors[].message`, not the top-level `message`.
 */
export function apiErrorMessage(status: number, body: Record<string, unknown>): string {
  const details = Array.isArray(body.errors)
    ? (body.errors as unknown[])
        .map((entry) =>
          typeof entry === 'string'
            ? entry
            : typeof (entry as { message?: unknown })?.message === 'string'
              ? (entry as { message: string }).message
              : null
        )
        .filter((message): message is string => !!message)
    : []
  if (details.length > 0) return `GitHub: ${details.join('; ')}`
  if (typeof body.message === 'string' && body.message) return `GitHub: ${body.message}`
  return `GitHub answered with HTTP ${status}.`
}
