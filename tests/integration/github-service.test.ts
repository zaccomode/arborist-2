import { promises as fs } from 'fs'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import { Store } from '../../src/main/services/persistence/store'
import { ProjectService } from '../../src/main/services/projects'
import { GitHubService } from '../../src/main/services/github/github-service'
import { SIGNED_OUT_CODE, type GitHubApi } from '../../src/main/services/github/github-api'
import { FAKE_TOKEN, FakeGitHubApi } from '../../src/main/services/github/fake-github'
import { TokenStore, type Encryptor } from '../../src/main/services/github/token-store'
import type { TokenPoll } from '@shared/github'
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
  if (api instanceof FakeGitHubApi && api.signedIn) await tokens.write(FAKE_TOKEN)
  return makeService(api, tokens)
}

function makeService(
  api: GitHubApi,
  tokens: TokenStore
): { github: GitHubService; tokens: TokenStore; opened: string[] } {
  const opened: string[] = []
  const github = new GitHubService({
    api,
    tokens,
    git: runner,
    store,
    projects: new ProjectService(store, runner),
    remoteUrl: (repoPath) => gitService.remoteUrl(repoPath),
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
    expect(await tokens.read()).toBe(FAKE_TOKEN)
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
    await new TokenStore(path, encryptor).write('ghu_secret')
    expect((await fs.readFile(path)).toString()).not.toContain('ghu_secret')
    const reopened = new TokenStore(path, encryptor)
    expect(reopened.remembers).toBe(true)
    expect(await reopened.read()).toBe('ghu_secret')
    await reopened.clear()
    expect(await new TokenStore(path, encryptor).read()).toBeNull()
  })

  it('holds the token in memory only without a keychain', async () => {
    const path = join(fixture.root, 'data', 'github-token.bin')
    const tokens = new TokenStore(path, { ...encryptor, isEncryptionAvailable: () => false })
    await tokens.write('ghu_secret')
    expect(tokens.remembers).toBe(false)
    expect(await tokens.read()).toBe('ghu_secret')
    expect(await fs.stat(path).catch(() => null)).toBeNull()
  })
})
