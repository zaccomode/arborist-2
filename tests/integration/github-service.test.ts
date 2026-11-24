import { promises as fs } from 'fs'
import { AppError } from '@shared/errors'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService, authFailureMessage } from '../../src/main/services/git/git-service'
import { Store } from '../../src/main/services/persistence/store'
import { ProjectService } from '../../src/main/services/projects'
import { GitHubService } from '../../src/main/services/github/github-service'
import { SIGNED_OUT_CODE, type GitHubApi } from '../../src/main/services/github/github-api'
import { FAKE_TOKEN, FakeGitHubApi } from '../../src/main/services/github/fake-github'
import { TokenStore, type Encryptor } from '../../src/main/services/github/token-store'
import { lastingCredentials, type GitHubCredentials, type TokenPoll } from '@shared/github'
import { makeFixtureRepo, type GitFixture } from './fixtures/git-fixture'

const runner = new GitRunner(new GitLocator())
const gitService = new GitService(runner)

let fixture: GitFixture
let remoteRoot: string
let store: Store

beforeEach(async () => {
  fixture = await makeFixtureRepo()
  remoteRoot = join(fixture.root, 'github')
  await fs.mkdir(join(remoteRoot, 'acme'), { recursive: true })
  await fixture.git(['clone', '--bare', fixture.repoPath, join(remoteRoot, 'acme', 'web.git')])
  ;({ store } = await Store.load(join(fixture.root, 'data', 'arborist-data.json')))
}, 60_000)

afterEach(async () => {
  await fixture?.cleanup()
})

function fakeApi(signedIn = true): FakeGitHubApi {
  return new FakeGitHubApi({
    signedIn,
    account: { login: 'me', name: 'Me' },
    installations: [
      { id: 1, owner: { login: 'me', type: 'User' }, repos: [] },
      {
        id: 2,
        owner: { login: 'acme', type: 'Organization' },
        repos: [{ id: 10, name: 'web', private: true, description: 'The site' }]
      }
    ],
    remoteRoot
  })
}

async function service(
  api: GitHubApi = fakeApi(),
  tokens = new TokenStore(null, null)
): Promise<{ github: GitHubService; tokens: TokenStore; opened: string[] }> {
  if (api instanceof FakeGitHubApi && api.signedIn)
    await tokens.write(lastingCredentials(FAKE_TOKEN))
  return makeService(api, tokens)
}

function makeService(
  api: GitHubApi,
  tokens: TokenStore,
  onSignedOut?: () => void
): { github: GitHubService; tokens: TokenStore; opened: string[] } {
  const opened: string[] = []
  const github = new GitHubService({
    onSignedOut,
    api,
    tokens,
    git: runner,
    store,
    projects: new ProjectService(store, runner),
    remoteUrl: (repoPath) => gitService.remoteUrl(repoPath),
    remoteUrls: (repoPath) => gitService.remoteUrls(repoPath),
    openExternal: async (url) => {
      opened.push(url)
      if (api instanceof FakeGitHubApi) api.approve()
    }
  })
  return { github, tokens, opened }
}

describe('signing in', () => {
  it('waits for the code to be approved, then remembers the account', async () => {
    const { github, tokens, opened } = await service(fakeApi(false))
    expect((await github.status()).account).toBeNull()

    const code = await github.startSignIn()
    expect(code.userCode).toBe('WDJB-MJHT')
    const finished = github.finishSignIn()
    await new Promise((resolve) => setTimeout(resolve, 250))
    await github.openPage('verification')

    expect(await finished).toEqual({ login: 'me', name: 'Me' })
    expect(opened).toEqual(['https://github.com/login/device'])
    expect((await tokens.read())?.accessToken).toBe(FAKE_TOKEN)
    expect((await github.status()).account?.login).toBe('me')
  })

  it('stops waiting when cancelled', async () => {
    const { github } = await service(fakeApi(false))
    await github.startSignIn()
    const finished = github.finishSignIn()
    github.cancelSignIn()
    await expect(finished).rejects.toMatchObject({ code: 'github-sign-in-cancelled' })
  })

  it('reports a code GitHub refuses, and keeps polling through pending and slow_down', async () => {
    const polls: TokenPoll[] = [
      { kind: 'pending' },
      { kind: 'slow-down', interval: 0 },
      { kind: 'failed', code: 'access_denied', message: 'The sign-in was cancelled on GitHub.' }
    ]
    let asked = 0
    const api = Object.assign(fakeApi(false), {
      pollDeviceToken: async () => {
        asked++
        return polls.shift()!
      }
    })
    const { github } = await service(api)
    await github.startSignIn()
    await expect(github.finishSignIn()).rejects.toThrow('The sign-in was cancelled on GitHub.')
    expect(asked).toBe(3)
  })

  it('only opens the verification page while a sign-in is waiting', async () => {
    const { github, opened } = await service()
    await expect(github.openPage('verification')).rejects.toMatchObject({
      code: 'github-no-sign-in'
    })
    await github.openPage('install')
    expect(opened).toEqual(['https://github.com/apps/arborist-2/installations/new'])
  })

  it('forgets a token GitHub no longer accepts', async () => {
    const api = Object.assign(fakeApi(true), {
      installations: async () => {
        throw Object.assign(new Error('GitHub signed Arborist out.'), { code: SIGNED_OUT_CODE })
      }
    })
    const { github, tokens } = await service(api)
    await expect(github.repos()).rejects.toMatchObject({ code: SIGNED_OUT_CODE })
    expect(await tokens.read()).toBeNull()
    expect((await github.status()).account).toBeNull()
  })
})

describe('signing in when part of it fails (#175)', () => {
  it('keeps a token whose account lookup failed, and reads the account later', async () => {
    let lookups = 0
    const api = Object.assign(fakeApi(false), {
      account: async () => {
        if (lookups++ === 0)
          throw new AppError('Could not reach GitHub: ECONNRESET', 'github-offline')
        return { login: 'me', name: 'Me' }
      }
    })
    const { github, tokens } = await service(api)
    await github.startSignIn()
    const finished = github.finishSignIn()
    await github.openPage('verification')

    await expect(finished).rejects.toMatchObject({ code: 'github-account-failed' })
    expect((await tokens.read())?.accessToken).toBe(FAKE_TOKEN)
    expect((await github.status()).account?.login).toBe('me')
  })

  it('stays signed out when the token could not be saved', async () => {
    const path = join(fixture.root, 'data', 'github-token.bin')
    const tokens = new TokenStore(path, {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error('keychain locked')
      },
      decryptString: (encrypted) => encrypted.toString()
    })
    const { github } = await service(fakeApi(false), tokens)
    await github.startSignIn()
    const finished = github.finishSignIn()
    await github.openPage('verification')

    await expect(finished).rejects.toThrow('keychain locked')
    expect(await tokens.read()).toBeNull()
    expect((await github.status()).account).toBeNull()
  })
})

describe('expiring tokens (#174)', () => {
  const expired = (): GitHubCredentials => ({
    accessToken: 'ghu_old',
    expiresAt: Date.now() - 1000,
    refreshToken: 'ghr_old',
    refreshExpiresAt: Date.now() + 60_000
  })
  const renewed: TokenPoll = {
    kind: 'token',
    token: 'ghu_new',
    expiresIn: 28800,
    refreshToken: 'ghr_new',
    refreshTokenExpiresIn: 15897600
  }

  it('refreshes an expired token once, however many calls want it, and keeps the new pair', async () => {
    const refreshedWith: string[] = []
    const usedTokens: string[] = []
    const api = Object.assign(fakeApi(false), {
      refreshToken: async (refreshToken: string) => {
        refreshedWith.push(refreshToken)
        return renewed
      },
      installations: async (token: string) => {
        usedTokens.push(token)
        return []
      }
    })
    const tokens = new TokenStore(null, null)
    await tokens.write(expired())
    const { github } = makeService(api, tokens)

    await Promise.all([github.repos(), github.repos(), github.owners()])
    expect(refreshedWith).toEqual(['ghr_old'])
    expect(new Set(usedTokens)).toEqual(new Set(['ghu_new']))
    expect(await tokens.read()).toMatchObject({ accessToken: 'ghu_new', refreshToken: 'ghr_new' })
  })

  it('refreshes and retries once when GitHub refuses a token before its expiry', async () => {
    const api = Object.assign(fakeApi(false), {
      refreshToken: async () => renewed,
      installations: async (token: string) => {
        if (token === 'ghu_old') {
          throw new AppError('GitHub signed Arborist out.', SIGNED_OUT_CODE)
        }
        return []
      }
    })
    const tokens = new TokenStore(null, null)
    await tokens.write({ ...expired(), expiresAt: Date.now() + 3_600_000 })
    const { github } = makeService(api, tokens)

    await expect(github.repos()).resolves.toEqual([])
    expect((await tokens.read())?.accessToken).toBe('ghu_new')
  })

  it('signs out when GitHub refuses the refresh token', async () => {
    const api = Object.assign(fakeApi(false), {
      refreshToken: async (): Promise<TokenPoll> => ({
        kind: 'failed',
        code: 'bad_refresh_token',
        message: 'GitHub no longer accepts this sign-in.'
      })
    })
    const tokens = new TokenStore(null, null)
    await tokens.write(expired())
    const { github } = makeService(api, tokens)

    await expect(github.repos()).rejects.toMatchObject({ code: SIGNED_OUT_CODE })
    expect(await tokens.read()).toBeNull()
  })

  it('signs out when the refresh token has expired too', async () => {
    const tokens = new TokenStore(null, null)
    await tokens.write({ ...expired(), refreshExpiresAt: Date.now() - 1 })
    const { github } = makeService(fakeApi(false), tokens)
    expect((await github.status()).account).toBeNull()
    expect(await tokens.read()).toBeNull()
  })
})

describe('the sign-in changing while GitHub answers (#178)', () => {
  const expired = (): GitHubCredentials => ({
    accessToken: 'ghu_old',
    expiresAt: Date.now() - 1000,
    refreshToken: 'ghr_old',
    refreshExpiresAt: Date.now() + 60_000
  })
  const renewed: TokenPoll = { kind: 'token', token: 'ghu_new', expiresIn: 28800 }

  /** An API whose refresh waits until `answer` is called. */
  function pendingRefresh(): { api: FakeGitHubApi; answer: (poll: TokenPoll) => void } {
    let answer: (poll: TokenPoll) => void = () => {}
    const api = Object.assign(fakeApi(false), {
      refreshToken: () =>
        new Promise<TokenPoll>((resolve) => {
          answer = resolve
        })
    })
    return { api, answer: (poll) => answer(poll) }
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  it('stays signed out when a refresh lands after signing out', async () => {
    const { api, answer } = pendingRefresh()
    const tokens = new TokenStore(null, null)
    await tokens.write(expired())
    const { github } = makeService(api, tokens)

    const listing = github.repos()
    await settle()
    await github.signOut()
    answer(renewed)

    await expect(listing).rejects.toMatchObject({ code: SIGNED_OUT_CODE })
    expect(await tokens.read()).toBeNull()
  })

  it('keeps a new sign-in when the old one’s refresh lands after it', async () => {
    const { api, answer } = pendingRefresh()
    const tokens = new TokenStore(null, null)
    await tokens.write(expired())
    const { github } = makeService(api, tokens)

    const listing = github.repos()
    await settle()
    await github.signOut()
    await github.startSignIn()
    const signingIn = github.finishSignIn()
    await github.openPage('verification')
    await signingIn
    answer(renewed)
    await listing.catch(() => {})

    expect((await tokens.read())?.accessToken).toBe(FAKE_TOKEN)
    expect((await github.status()).account?.login).toBe('me')
  })

  it('keeps the sign-in when GitHub can’t be reached, or has an outage, to refresh', async () => {
    const failures: (() => Promise<TokenPoll>)[] = [
      async () => {
        throw new AppError('Could not reach GitHub: fetch failed', 'github-offline')
      },
      async () => {
        throw new AppError('GitHub answered with HTTP 503.', 'github-request-failed')
      },
      // What 3.13 read an empty 503 as: an answer that isn't a refusal.
      async () => ({ kind: 'failed', code: 'unknown', message: 'GitHub sign-in failed.' })
    ]
    for (const refreshToken of failures) {
      let signedOut = 0
      const api = Object.assign(fakeApi(false), { refreshToken })
      const tokens = new TokenStore(null, null)
      await tokens.write(expired())
      const { github } = makeService(api, tokens, () => signedOut++)
      await expect(github.repos()).rejects.toMatchObject({
        code: expect.stringMatching(/^github-(offline|request-failed)$/)
      })
      expect((await tokens.read())?.refreshToken).toBe('ghr_old')
      expect(signedOut).toBe(0)
    }
  })

  it('keeps the sign-in when GitHub refuses a token and then can’t be reached to refresh it', async () => {
    const api = Object.assign(fakeApi(false), {
      refreshToken: async (): Promise<TokenPoll> => {
        throw new AppError('Could not reach GitHub: fetch failed', 'github-offline')
      },
      installations: async () => {
        throw new AppError('GitHub signed Arborist out.', SIGNED_OUT_CODE)
      }
    })
    const tokens = new TokenStore(null, null)
    await tokens.write({ ...expired(), expiresAt: Date.now() + 3_600_000 })
    const { github } = makeService(api, tokens)

    await expect(github.repos()).rejects.toMatchObject({ code: 'github-offline' })
    expect((await tokens.read())?.accessToken).toBe('ghu_old')
  })

  it('tells the renderer when it signs out on its own, and not when asked to', async () => {
    const api = Object.assign(fakeApi(false), {
      refreshToken: async (): Promise<TokenPoll> => ({
        kind: 'failed',
        code: 'bad_refresh_token',
        message: 'GitHub no longer accepts this sign-in.'
      })
    })
    const tokens = new TokenStore(null, null)
    await tokens.write(expired())
    let told = 0
    const { github } = makeService(api, tokens, () => told++)

    await expect(github.repos()).rejects.toMatchObject({ code: SIGNED_OUT_CODE })
    expect(await tokens.read()).toBeNull()
    expect(told).toBe(1)

    await tokens.write(lastingCredentials('ghu_other'))
    await github.signOut()
    expect(told).toBe(1)
  })
})

describe('fetch, pull and push in a signed-in project (#174)', () => {
  const granted = 'https://github.com/acme/web.git'

  beforeEach(async () => {
    await fixture.git(['remote', 'set-url', 'origin', granted])
    await fixture.git(['remote', 'add', 'other', 'https://github.com/someone/else.git'])
    await fixture.git(['remote', 'add', 'mirror', 'git@github.com:acme/web.git'])
  })

  /** What git would send to `url` with `env`, read back through git's own URL matching. */
  async function headerFor(url: string, env: Record<string, string>): Promise<string | null> {
    const result = await runner.run(['config', '--get-urlmatch', 'http.extraheader', url], {
      repoPath: fixture.repoPath,
      env
    })
    return result.exitCode === 0 ? result.stdout.trim() : null
  }

  it('sends the token only to the remotes whose repository the app can reach', async () => {
    const { github } = await service()
    const env = await github.networkEnv(fixture.repoPath)
    expect(env).toBeDefined()
    expect(await headerFor(granted, env!)).toBe(
      `Authorization: Basic ${btoa(`x-access-token:${FAKE_TOKEN}`)}`
    )
    expect(await headerFor('https://github.com/someone/else.git', env!)).toBeNull()
    expect(await headerFor('https://github.com/acme/web-other.git', env!)).toBeNull()
  })

  it('adds nothing when signed out, or for a project with no GitHub HTTPS remote', async () => {
    const signedOut = await service(fakeApi(false))
    expect(await signedOut.github.networkEnv(fixture.repoPath)).toBeUndefined()

    await fixture.git(['remote', 'set-url', 'origin', 'git@github.com:acme/web.git'])
    const { github } = await service()
    expect(await github.networkEnv(fixture.repoPath)).toBeUndefined()
  })

  it('adds nothing, rather than failing the git call, when GitHub cannot be reached', async () => {
    const api = Object.assign(fakeApi(true), {
      installations: async () => {
        throw new AppError('Could not reach GitHub.', 'github-offline')
      }
    })
    const { github } = await service(api)
    expect(await github.networkEnv(fixture.repoPath)).toBeUndefined()
  })

  describe('the listing of repositories it decides by (#179)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    /** An API counting its listings, whose `installations` can be swapped mid-test. */
    function countingApi(): {
      api: FakeGitHubApi
      listings: () => number
      setInstallations: (next: FakeGitHubApi['installations']) => void
    } {
      const base = fakeApi(true)
      let impl = base.installations.bind(base)
      let count = 0
      const api = Object.assign(base, {
        installations: (token: string) => {
          count++
          return impl(token)
        }
      })
      return { api, listings: () => count, setInstallations: (next) => (impl = next) }
    }

    function advanceClock(ms: number): void {
      const now = Date.now() + ms
      vi.spyOn(Date, 'now').mockReturnValue(now)
    }

    it('uses an out-of-date listing while a new one loads, rather than waiting on it', async () => {
      const { api, listings, setInstallations } = countingApi()
      const { github } = await service(api)
      expect(await github.networkEnv(fixture.repoPath)).toBeDefined()
      expect(listings()).toBe(1)

      expect(await github.networkEnv(fixture.repoPath)).toBeDefined()
      expect(listings()).toBe(1)

      setInstallations(() => new Promise(() => {}))
      advanceClock(6 * 60_000)
      expect(await github.networkEnv(fixture.repoPath)).toBeDefined()
      expect(listings()).toBe(2)
    })

    it('waits a few seconds at most for a first listing, and goes ahead without the token', async () => {
      const { api, setInstallations } = countingApi()
      setInstallations(() => new Promise(() => {}))
      const { github } = await service(api)
      const started = Date.now()
      expect(await github.networkEnv(fixture.repoPath)).toBeUndefined()
      expect(Date.now() - started).toBeLessThan(6_000)
    }, 15_000)

    it('waits a while before listing again after a listing failed', async () => {
      const { api, listings, setInstallations } = countingApi()
      setInstallations(async () => {
        throw new AppError('Could not reach GitHub.', 'github-offline')
      })
      const { github } = await service(api)
      expect(await github.networkEnv(fixture.repoPath)).toBeUndefined()
      expect(await github.networkEnv(fixture.repoPath)).toBeUndefined()
      expect(listings()).toBe(1)

      setInstallations(fakeApi(true).installations.bind(fakeApi(true)))
      advanceClock(31_000)
      expect(await github.networkEnv(fixture.repoPath)).toBeDefined()
      expect(listings()).toBe(2)
    })
  })

  it('retries once without the token when the remote refuses it', async () => {
    const seen: (string | undefined)[] = []
    const server: Server = createServer((request, response) => {
      seen.push(request.headers.authorization)
      response.statusCode = request.headers.authorization ? 403 : 401
      response.setHeader('WWW-Authenticate', 'Basic realm="test"')
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/acme/web.git`
    try {
      await fixture.git(['remote', 'remove', 'other'])
      await fixture.git(['remote', 'remove', 'mirror'])
      await fixture.git(['remote', 'set-url', 'origin', url])
      const env = {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `http.${url}.extraheader`,
        GIT_CONFIG_VALUE_0: 'Authorization: Basic dGVzdA=='
      }
      const signed = new GitService(
        runner,
        () => {},
        async () => env
      )
      await expect(signed.fetchAll(fixture.repoPath)).rejects.toMatchObject({
        code: 'fetch-auth-failed',
        message: authFailureMessage('fetch', true)
      })
      // The first try carried the header; the retry, git's own credentials (none here).
      expect(seen[0]).toBe('Basic dGVzdA==')
      expect(seen.at(-1)).toBeUndefined()

      seen.length = 0
      await expect(gitService.fetchAll(fixture.repoPath)).rejects.toMatchObject({
        message: authFailureMessage('fetch', false)
      })
      expect(seen.every((header) => header === undefined)).toBe(true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }, 30_000)

  it('reaches git through GitService’s fetch, pull and push', async () => {
    const seen: (string | undefined)[] = []
    const server: Server = createServer((request, response) => {
      seen.push(request.headers.authorization)
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/acme/web.git`
    try {
      await fixture.git(['remote', 'remove', 'other'])
      await fixture.git(['remote', 'remove', 'mirror'])
      await fixture.git(['remote', 'set-url', 'origin', url])
      const asked: string[] = []
      const signed = new GitService(
        runner,
        () => {},
        async (repoPath) => {
          asked.push(repoPath)
          return {
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: `http.${url}.extraheader`,
            GIT_CONFIG_VALUE_0: 'Authorization: Basic dGVzdA=='
          }
        }
      )
      await expect(signed.fetchAll(fixture.repoPath)).rejects.toThrow()
      await expect(signed.pull(fixture.repoPath, 'ff-only')).rejects.toThrow()
      await expect(signed.push(fixture.repoPath, 'main', true)).rejects.toThrow()
      expect(asked).toEqual([fixture.repoPath, fixture.repoPath, fixture.repoPath])
      expect(seen.length).toBeGreaterThanOrEqual(3)
      expect(seen.every((header) => header === 'Basic dGVzdA==')).toBe(true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }, 30_000)
})

describe('listing', () => {
  it('lists every installation’s repositories, and the owners with the account first', async () => {
    const { github } = await service()
    expect((await github.repos()).map((repo) => repo.fullName)).toEqual(['acme/web'])
    expect(await github.owners()).toEqual([
      { login: 'me', type: 'User' },
      { login: 'acme', type: 'Organization' }
    ])
  })
})

describe('cloning', () => {
  it('clones into the chosen folder, adds the project, and remembers the folder', async () => {
    const { github } = await service()
    await github.repos()
    const parent = join(fixture.root, 'clones')
    await fs.mkdir(parent)

    const project = await github.clone(10, 'https', parent)

    expect(project.name).toBe('web')
    expect(project.path).toBe(join(parent, 'web'))
    expect(await fs.readFile(join(parent, 'web', 'README.md'), 'utf8')).toBe('# fixture\n')
    expect(store.data.repositories.map((repo) => repo.path)).toContain(join(parent, 'web'))
    expect(store.data.settings.lastCloneFolder).toBe(parent)
  }, 30_000)

  it('refuses a destination that already has something in it', async () => {
    const { github } = await service()
    await github.repos()
    const parent = join(fixture.root, 'clones')
    await fs.mkdir(join(parent, 'web'), { recursive: true })
    await fs.writeFile(join(parent, 'web', 'keep.txt'), 'mine')

    await expect(github.clone(10, 'https', parent)).rejects.toMatchObject({
      code: 'clone-destination-exists'
    })
    expect(await fs.readFile(join(parent, 'web', 'keep.txt'), 'utf8')).toBe('mine')
  })

  it('refuses a repository it has not listed', async () => {
    const { github } = await service()
    await expect(github.clone(10, 'https', fixture.root)).rejects.toMatchObject({
      code: 'github-repo-unknown'
    })
  })

  /**
   * The token reaches git as a header on the clone's own requests, scoped to
   * that host, without appearing on the command line: a local server stands
   * in for GitHub and records what it was sent.
   */
  it('sends the token to an HTTPS remote as an Authorization header', async () => {
    const seen: (string | undefined)[] = []
    const server: Server = createServer((request, response) => {
      seen.push(request.headers.authorization)
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/acme/web.git`
    try {
      const api = Object.assign(fakeApi(true), {
        installationRepos: async () => [
          {
            id: 10,
            fullName: 'acme/web',
            owner: 'acme',
            name: 'web',
            private: true,
            description: null,
            cloneUrl: url,
            sshUrl: url,
            htmlUrl: 'https://github.com/acme/web'
          }
        ]
      })
      const { github } = await service(api)
      await github.repos()
      await expect(github.clone(10, 'https', fixture.root)).rejects.toThrow(/The clone failed/)
      expect(seen[0]).toBe(`Basic ${btoa(`x-access-token:${FAKE_TOKEN}`)}`)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }, 30_000)
})

describe('publishing', () => {
  beforeEach(async () => {
    await fixture.git(['remote', 'remove', 'origin'])
    await fixture.git(['branch', 'feature'])
    await store.update((data) => {
      data.repositories.push({
        id: 'p1',
        path: fixture.repoPath,
        name: 'project',
        addedAt: '2026-01-05T09:00:00.000Z'
      })
    })
  })

  const options = {
    owner: 'acme',
    name: 'My Project',
    description: 'Hello',
    private: true,
    protocol: 'https' as const,
    branches: ['feature', 'main']
  }

  it('creates the repository, adds it as origin, and pushes the chosen branches', async () => {
    const { github } = await service()
    const result = await github.publish('p1', options)

    expect(result).toEqual({
      fullName: 'acme/My-Project',
      htmlUrl: 'https://github.com/acme/My-Project'
    })
    const remote = join(remoteRoot, 'acme', 'My-Project.git')
    const heads = await fixture.git(['for-each-ref', '--format=%(refname)', 'refs/heads'], remote)
    expect(heads.trim().split('\n')).toEqual(['refs/heads/feature', 'refs/heads/main'])
    expect((await fixture.git(['rev-parse', '--abbrev-ref', 'main@{upstream}'])).trim()).toBe(
      'origin/main'
    )
    expect(await gitService.remoteUrl(fixture.repoPath)).toMatch(/My-Project\.git$/)
  }, 30_000)

  it('creates the repository and pushes nothing when no branch is chosen', async () => {
    const { github } = await service()
    await github.publish('p1', { ...options, branches: [] })
    const remote = join(remoteRoot, 'acme', 'My-Project.git')
    expect((await fixture.git(['for-each-ref', 'refs/heads'], remote)).trim()).toBe('')
  }, 30_000)

  it('refuses a project that already has a remote', async () => {
    await fixture.git(['remote', 'add', 'origin', fixture.remotePath])
    const { github } = await service()
    await expect(github.publish('p1', options)).rejects.toMatchObject({
      code: 'publish-has-remote'
    })
  })

  it('says the repository was created when only the push failed', async () => {
    const { github } = await service()
    const failure = github.publish('p1', { ...options, branches: ['no-such-branch'] })
    await expect(failure).rejects.toMatchObject({ code: 'publish-push-failed' })
    await expect(failure).rejects.toThrow(
      /Created acme\/My-Project on GitHub and added it as origin/
    )
    expect(await gitService.remoteUrl(fixture.repoPath)).toMatch(/My-Project\.git$/)
  }, 30_000)

  it('needs a name', async () => {
    const { github } = await service()
    await expect(github.publish('p1', { ...options, name: '!!' })).rejects.toMatchObject({
      code: 'publish-invalid-name'
    })
  })
})

describe('TokenStore', () => {
  const encryptor: Encryptor = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from([...plain].reverse().join('')),
    decryptString: (encrypted) => [...encrypted.toString()].reverse().join('')
  }

  it('keeps the token encrypted on disk, across instances', async () => {
    const path = join(fixture.root, 'data', 'github-token.bin')
    await new TokenStore(path, encryptor).write(lastingCredentials('ghu_secret'))
    expect((await fs.readFile(path)).toString()).not.toContain('ghu_secret')
    const reopened = new TokenStore(path, encryptor)
    expect(reopened.remembers).toBe(true)
    expect((await reopened.read())?.accessToken).toBe('ghu_secret')
    await reopened.clear()
    expect(await new TokenStore(path, encryptor).read()).toBeNull()
  })

  it('reads a token stored bare by 3.12 as a sign-in that does not expire', async () => {
    const path = join(fixture.root, 'data', 'github-token.bin')
    await fs.mkdir(join(fixture.root, 'data'), { recursive: true })
    await fs.writeFile(path, encryptor.encryptString('ghu_old'))
    expect(await new TokenStore(path, encryptor).read()).toEqual(lastingCredentials('ghu_old'))
  })

  it('does not remember the token on Linux’s plaintext fallback (#174)', async () => {
    const path = join(fixture.root, 'data', 'github-token.bin')
    const tokens = new TokenStore(path, {
      ...encryptor,
      getSelectedStorageBackend: () => 'basic_text'
    })
    expect(tokens.remembers).toBe(false)
    await tokens.write(lastingCredentials('ghu_secret'))
    expect(await fs.stat(path).catch(() => null)).toBeNull()
    expect(
      new TokenStore(path, { ...encryptor, getSelectedStorageBackend: () => 'gnome_libsecret' })
        .remembers
    ).toBe(true)
  })

  it('holds the token in memory only without a keychain', async () => {
    const path = join(fixture.root, 'data', 'github-token.bin')
    const tokens = new TokenStore(path, { ...encryptor, isEncryptionAvailable: () => false })
    await tokens.write(lastingCredentials('ghu_secret'))
    expect(tokens.remembers).toBe(false)
    expect((await tokens.read())?.accessToken).toBe('ghu_secret')
    expect(await fs.stat(path).catch(() => null)).toBeNull()
  })
})
