import { describe, expect, it } from 'vitest'
import {
  GITHUB_REFRESH_TIMEOUT_MS,
  GITHUB_REQUEST_TIMEOUT_MS,
  HttpGitHubApi,
  SIGNED_OUT_CODE,
  apiErrorMessage
} from '../../src/main/services/github/github-api'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

/** A `fetch` that answers from a list of canned responses, recording each request. */
function scripted(responses: { status?: number; body: unknown }[]): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  calls: Call[]
} {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body as string | undefined
      })
      const next = responses.shift()
      if (!next) throw new Error(`unexpected request to ${url}`)
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
    }
  }
}

const options = { webUrl: 'https://gh.test', apiUrl: 'https://api.gh.test', clientId: 'Iv1' }

describe('HttpGitHubApi device flow', () => {
  it('requests a code with the client id and no scope', async () => {
    const { fetch, calls } = scripted([
      {
        body: {
          device_code: 'dc',
          user_code: 'ABCD-1234',
          verification_uri: 'https://gh.test/login/device',
          expires_in: 899,
          interval: 5
        }
      }
    ])
    const code = await new HttpGitHubApi(fetch, options).requestDeviceCode()
    expect(code).toEqual({
      deviceCode: 'dc',
      userCode: 'ABCD-1234',
      verificationUri: 'https://gh.test/login/device',
      expiresIn: 899,
      interval: 5
    })
    expect(calls[0].url).toBe('https://gh.test/login/device/code')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers.Accept).toBe('application/json')
    expect(calls[0].body).toBe('client_id=Iv1')
  })

  it('reports a refused code request in GitHub’s words', async () => {
    const { fetch } = scripted([
      { body: { error: 'device_flow_disabled', error_description: 'Device Flow must be enabled' } }
    ])
    await expect(new HttpGitHubApi(fetch, options).requestDeviceCode()).rejects.toThrow(
      'Device Flow must be enabled'
    )
  })

  it('polls with the device-code grant', async () => {
    const { fetch, calls } = scripted([{ body: { error: 'authorization_pending' } }])
    expect(await new HttpGitHubApi(fetch, options).pollDeviceToken('dc')).toEqual({
      kind: 'pending'
    })
    const params = new URLSearchParams(calls[0].body)
    expect(calls[0].url).toBe('https://gh.test/login/oauth/access_token')
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(params.get('device_code')).toBe('dc')
    expect(params.get('client_id')).toBe('Iv1')
  })
})

describe('HttpGitHubApi refresh (#174)', () => {
  it('swaps a refresh token with no client secret, and reads the new pair', async () => {
    const { fetch, calls } = scripted([
      {
        body: {
          access_token: 'ghu_new',
          expires_in: 28800,
          refresh_token: 'ghr_new',
          refresh_token_expires_in: 15897600
        }
      }
    ])
    const poll = await new HttpGitHubApi(fetch, options).refreshToken('ghr_old')
    expect(calls[0].url).toBe('https://gh.test/login/oauth/access_token')
    const sent = new URLSearchParams(calls[0].body)
    expect(Object.fromEntries(sent)).toEqual({
      client_id: 'Iv1',
      grant_type: 'refresh_token',
      refresh_token: 'ghr_old'
    })
    expect(poll).toMatchObject({ kind: 'token', token: 'ghu_new', refreshToken: 'ghr_new' })
  })
})

describe('HttpGitHubApi failures (#178, #179)', () => {
  it('passes an OAuth error through whatever the status, for the service to judge', async () => {
    const { fetch } = scripted([{ status: 400, body: { error: 'bad_refresh_token' } }])
    expect(await new HttpGitHubApi(fetch, options).refreshToken('ghr')).toMatchObject({
      kind: 'failed',
      code: 'bad_refresh_token'
    })
  })

  it('throws, rather than answering "failed", on an outage or a rate limit', async () => {
    const empty = async (): Promise<Response> => new Response('', { status: 503 })
    await expect(new HttpGitHubApi(empty, options).refreshToken('ghr')).rejects.toMatchObject({
      code: 'github-request-failed',
      message: 'GitHub answered with HTTP 503.'
    })
    const { fetch } = scripted([{ status: 429, body: { message: 'API rate limit exceeded' } }])
    await expect(new HttpGitHubApi(fetch, options).refreshToken('ghr')).rejects.toMatchObject({
      code: 'github-request-failed',
      message: 'GitHub: API rate limit exceeded'
    })
  })

  it('gives up on a request GitHub never answers', async () => {
    const hanging = (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })
    const api = new HttpGitHubApi(hanging, { ...options, timeoutMs: 50, refreshTimeoutMs: 100 })
    await expect(api.account('tok')).rejects.toMatchObject({ code: 'github-offline' })
    await expect(api.refreshToken('ghr')).rejects.toMatchObject({ code: 'github-offline' })
  })

  it('waits well past the general timeout for a refresh, which spends the old token (#182)', async () => {
    const slow = (url: string, init?: RequestInit): Promise<Response> =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        setTimeout(() => {
          const body = url.endsWith('/user')
            ? { login: 'me', name: null }
            : { access_token: 'ghu_new', expires_in: 28800, refresh_token: 'ghr_new' }
          resolve(new Response(JSON.stringify(body)))
        }, 150)
      })
    const api = new HttpGitHubApi(slow, { ...options, timeoutMs: 50 })
    expect(await api.refreshToken('ghr_old')).toMatchObject({ kind: 'token', token: 'ghu_new' })
    // Every other request keeps the general bound.
    await expect(api.account('tok')).rejects.toMatchObject({ code: 'github-offline' })
    await expect(api.pollDeviceToken('dc')).rejects.toMatchObject({ code: 'github-offline' })
  })

  it('bounds the refresh well past the general timeout by default (#182)', () => {
    expect(GITHUB_REFRESH_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * GITHUB_REQUEST_TIMEOUT_MS)
  })
})

describe('HttpGitHubApi REST calls', () => {
  it('sends the token and API version, and reads the account', async () => {
    const { fetch, calls } = scripted([{ body: { login: 'me', name: 'Me Myself' } }])
    expect(await new HttpGitHubApi(fetch, options).account('tok')).toEqual({
      login: 'me',
      name: 'Me Myself'
    })
    expect(calls[0].url).toBe('https://api.gh.test/user')
    expect(calls[0].headers.Authorization).toBe('Bearer tok')
    expect(calls[0].headers['X-GitHub-Api-Version']).toBe('2022-11-28')
  })

  it('reads every page of an installation’s repositories', async () => {
    const page = (start: number, count: number): unknown[] =>
      Array.from({ length: count }, (_, index) => ({
        id: start + index,
        full_name: `acme/r${start + index}`,
        name: `r${start + index}`,
        owner: { login: 'acme' },
        private: true,
        description: null,
        clone_url: 'https://x',
        ssh_url: 'git@x',
        html_url: 'https://h'
      }))
    const { fetch, calls } = scripted([
      { body: { total_count: 130, repositories: page(0, 100) } },
      { body: { total_count: 130, repositories: page(100, 30) } }
    ])
    const repos = await new HttpGitHubApi(fetch, options).installationRepos('tok', 7)
    expect(repos).toHaveLength(130)
    expect(repos[129]).toMatchObject({ id: 129, fullName: 'acme/r129', owner: 'acme' })
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.gh.test/user/installations/7/repositories?per_page=100&page=1',
      'https://api.gh.test/user/installations/7/repositories?per_page=100&page=2'
    ])
  })

  it('reads installations as owners', async () => {
    const { fetch } = scripted([
      {
        body: {
          total_count: 2,
          installations: [
            { id: 1, account: { login: 'me', type: 'User' } },
            { id: 2, account: { login: 'acme', type: 'Organization' } }
          ]
        }
      }
    ])
    expect(await new HttpGitHubApi(fetch, options).installations('tok')).toEqual([
      { id: 1, owner: { login: 'me', type: 'User' } },
      { id: 2, owner: { login: 'acme', type: 'Organization' } }
    ])
  })

  it('creates a personal repository under /user, and an organisation’s under /orgs', async () => {
    const created = {
      id: 9,
      full_name: 'acme/new',
      name: 'new',
      owner: { login: 'acme' },
      private: true,
      description: null,
      clone_url: 'https://gh.test/acme/new.git',
      ssh_url: 'git@gh.test:acme/new.git',
      html_url: 'https://gh.test/acme/new'
    }
    const { fetch, calls } = scripted([
      { status: 201, body: created },
      { status: 201, body: created }
    ])
    const api = new HttpGitHubApi(fetch, options)
    await api.createRepo(
      'tok',
      { login: 'me', personal: true },
      { name: 'new', description: '', private: true }
    )
    const result = await api.createRepo(
      'tok',
      { login: 'acme', personal: false },
      { name: 'new', description: 'Hi', private: false }
    )
    expect(calls[0].url).toBe('https://api.gh.test/user/repos')
    expect(JSON.parse(calls[0].body!)).toEqual({ name: 'new', private: true })
    expect(calls[1].url).toBe('https://api.gh.test/orgs/acme/repos')
    expect(JSON.parse(calls[1].body!)).toEqual({ name: 'new', description: 'Hi', private: false })
    expect(result).toMatchObject({ fullName: 'acme/new', htmlUrl: 'https://gh.test/acme/new' })
  })

  it('marks a 401 as signed out', async () => {
    const { fetch } = scripted([{ status: 401, body: { message: 'Bad credentials' } }])
    await expect(new HttpGitHubApi(fetch, options).account('tok')).rejects.toMatchObject({
      code: SIGNED_OUT_CODE
    })
  })

  it('reports a body that is not JSON by its status, rather than a parse error (#175)', async () => {
    const api = new HttpGitHubApi(
      async () => new Response('<html>Bad gateway</html>', { status: 502 }),
      options
    )
    const failure = api.account('tok')
    await expect(failure).rejects.toMatchObject({ code: 'github-request-failed' })
    await expect(failure).rejects.toThrow('GitHub answered with HTTP 502.')
  })

  it('reports being offline as such', async () => {
    const api = new HttpGitHubApi(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }, options)
    await expect(api.account('tok')).rejects.toMatchObject({ code: 'github-offline' })
  })
})

describe('apiErrorMessage', () => {
  it('prefers the detailed errors GitHub gives for a 422', () => {
    expect(
      apiErrorMessage(422, {
        message: 'Repository creation failed.',
        errors: [
          { resource: 'Repository', field: 'name', message: 'name already exists on this account' }
        ]
      })
    ).toBe('GitHub: name already exists on this account')
  })

  it('falls back to the message, then the status', () => {
    expect(apiErrorMessage(403, { message: 'Resource not accessible by integration' })).toBe(
      'GitHub: Resource not accessible by integration'
    )
    expect(apiErrorMessage(500, {})).toBe('GitHub answered with HTTP 500.')
  })
})
