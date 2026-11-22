import { describe, expect, it } from 'vitest'
import type { Repository } from '@shared/persisted'
import {
  REFRESH_MARGIN_MS,
  canRefresh,
  cloneUrlFor,
  credentialsFrom,
  filterRepos,
  gitAuthEnv,
  githubRepoForUrl,
  lastingCredentials,
  parseCredentials,
  refreshDue,
  repoAuthEnv,
  serializeCredentials,
  groupReposByOwner,
  installUrl,
  interpretTokenPoll,
  nextPollInterval,
  projectsByRepo,
  repoNameFor,
  sortOwners,
  sortRepos,
  type GitHubRepo
} from '@shared/github'
import { childPath } from '@shared/paths'
import { parseRemoteUrl } from '@shared/project-groups'

function repo(id: number, fullName: string, extra: Partial<GitHubRepo> = {}): GitHubRepo {
  const [owner, name] = fullName.split('/')
  return {
    id,
    fullName,
    owner,
    name,
    private: false,
    description: null,
    cloneUrl: `https://github.com/${fullName}.git`,
    sshUrl: `git@github.com:${fullName}.git`,
    htmlUrl: `https://github.com/${fullName}`,
    ...extra
  }
}

describe('interpretTokenPoll', () => {
  it('reads a token', () => {
    expect(interpretTokenPoll({ access_token: 'ghu_x', token_type: 'bearer' })).toEqual({
      kind: 'token',
      token: 'ghu_x'
    })
  })

  it('keeps waiting while the code is pending', () => {
    expect(interpretTokenPoll({ error: 'authorization_pending' })).toEqual({ kind: 'pending' })
  })

  it('slows down, with or without a new interval', () => {
    expect(interpretTokenPoll({ error: 'slow_down', interval: 10 })).toEqual({
      kind: 'slow-down',
      interval: 10
    })
    expect(interpretTokenPoll({ error: 'slow_down' })).toEqual({
      kind: 'slow-down',
      interval: null
    })
  })

  it('explains the failures a person can hit in their own words', () => {
    const expired = interpretTokenPoll({ error: 'expired_token' })
    expect(expired).toMatchObject({ kind: 'failed', code: 'expired_token' })
    expect((expired as { message: string }).message).toMatch(/expired/)
    expect(interpretTokenPoll({ error: 'access_denied' })).toMatchObject({
      kind: 'failed',
      message: 'The sign-in was cancelled on GitHub.'
    })
  })

  it("falls back to GitHub's own description, then to the code", () => {
    expect(interpretTokenPoll({ error: 'odd', error_description: 'Something odd.' })).toMatchObject(
      { kind: 'failed', message: 'Something odd.' }
    )
    expect(interpretTokenPoll(null)).toMatchObject({ kind: 'failed', code: 'unknown' })
  })
})

describe('interpretTokenPoll expiry (#174)', () => {
  it('keeps the refresh token and lifetimes GitHub sends with an expiring token', () => {
    expect(
      interpretTokenPoll({
        access_token: 'ghu_a',
        expires_in: 28800,
        refresh_token: 'ghr_a',
        refresh_token_expires_in: 15897600,
        token_type: 'bearer',
        scope: ''
      })
    ).toEqual({
      kind: 'token',
      token: 'ghu_a',
      expiresIn: 28800,
      refreshToken: 'ghr_a',
      refreshTokenExpiresIn: 15897600
    })
  })

  it('reads a token that does not expire as just the token', () => {
    expect(interpretTokenPoll({ access_token: 'ghu_a', expires_in: 'soon' })).toEqual({
      kind: 'token',
      token: 'ghu_a'
    })
  })

  it('explains a refresh token GitHub refuses', () => {
    expect(interpretTokenPoll({ error: 'bad_refresh_token' })).toMatchObject({
      kind: 'failed',
      message: 'GitHub no longer accepts this sign-in. Sign in again to continue.'
    })
  })
})

describe('nextPollInterval', () => {
  it('adds five seconds on slow_down, unless GitHub names an interval', () => {
    expect(nextPollInterval(5, { kind: 'slow-down', interval: null })).toBe(10)
    expect(nextPollInterval(5, { kind: 'slow-down', interval: 15 })).toBe(15)
    expect(nextPollInterval(5, { kind: 'pending' })).toBe(5)
  })
})

describe('filterRepos', () => {
  const repos = [
    repo(1, 'acme/web', { description: 'The marketing site' }),
    repo(2, 'acme/api'),
    repo(3, 'zaccomode/arborist-2', { description: 'Worktree manager' })
  ]

  it('keeps everything for an empty query', () => {
    expect(filterRepos(repos, '  ')).toEqual(repos)
  })

  it('matches every word against the full name and description, ignoring case', () => {
    expect(filterRepos(repos, 'ACME').map((entry) => entry.id)).toEqual([1, 2])
    expect(filterRepos(repos, 'acme site').map((entry) => entry.id)).toEqual([1])
    expect(filterRepos(repos, 'worktree').map((entry) => entry.id)).toEqual([3])
    expect(filterRepos(repos, 'zacc/arb')).toEqual([])
  })
})

describe('sortRepos and groupReposByOwner', () => {
  it('sorts by owner then name, drops duplicates, and groups in that order', () => {
    const sorted = sortRepos([
      repo(3, 'zed/a'),
      repo(2, 'Acme/web'),
      repo(1, 'acme/API'),
      repo(2, 'Acme/web')
    ])
    expect(sorted.map((entry) => entry.fullName)).toEqual(['acme/API', 'Acme/web', 'zed/a'])
    expect(groupReposByOwner(sorted).map((group) => [group.owner, group.repos.length])).toEqual([
      ['acme', 1],
      ['Acme', 1],
      ['zed', 1]
    ])
  })
})

describe('sortOwners', () => {
  it('puts the signed-in account first, then other users, then organisations', () => {
    const sorted = sortOwners(
      [
        { login: 'zeta', type: 'Organization' },
        { login: 'acme', type: 'Organization' },
        { login: 'Me', type: 'User' },
        { login: 'acme', type: 'Organization' }
      ],
      'me'
    )
    expect(sorted.map((owner) => owner.login)).toEqual(['Me', 'acme', 'zeta'])
  })
})

describe('repoNameFor', () => {
  it('keeps a valid name as it is', () => {
    expect(repoNameFor('arborist-2')).toBe('arborist-2')
    expect(repoNameFor('My_Repo.js')).toBe('My_Repo.js')
  })

  it('turns each run of other characters into one hyphen, as GitHub does', () => {
    expect(repoNameFor('  my cool  project! ')).toBe('my-cool-project-')
    expect(repoNameFor('café')).toBe('caf-')
  })

  it('has no name for nothing usable', () => {
    expect(repoNameFor('')).toBeNull()
    expect(repoNameFor('!!!')).toBeNull()
    expect(repoNameFor('.')).toBeNull()
    expect(repoNameFor('..')).toBeNull()
  })

  it('stops at GitHub’s hundred characters', () => {
    expect(repoNameFor('a'.repeat(150))).toHaveLength(100)
  })
})

describe('cloneUrlFor', () => {
  it('picks the URL for the protocol', () => {
    const target = repo(1, 'acme/web')
    expect(cloneUrlFor(target, 'https')).toBe('https://github.com/acme/web.git')
    expect(cloneUrlFor(target, 'ssh')).toBe('git@github.com:acme/web.git')
  })
})

describe('gitAuthEnv', () => {
  it('scopes a basic-auth header to the URL’s origin, through GIT_CONFIG_COUNT', () => {
    const env = gitAuthEnv('https://github.com/acme/web.git', 'ghu_abc', {})
    expect(env).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${btoa('x-access-token:ghu_abc')}`
    })
  })

  it('appends after entries the environment already carries', () => {
    const env = gitAuthEnv('https://github.com/acme/web.git', 't', { GIT_CONFIG_COUNT: '2' })
    expect(env.GIT_CONFIG_COUNT).toBe('3')
    expect(env.GIT_CONFIG_KEY_2).toBe('http.https://github.com/.extraheader')
  })

  it('adds nothing for SSH, scp-like or local URLs', () => {
    expect(gitAuthEnv('git@github.com:acme/web.git', 't', {})).toEqual({})
    expect(gitAuthEnv('ssh://git@github.com/acme/web.git', 't', {})).toEqual({})
    expect(gitAuthEnv('file:///tmp/web.git', 't', {})).toEqual({})
  })
})

describe('repoAuthEnv', () => {
  const header = `Authorization: Basic ${btoa('x-access-token:t')}`

  it('scopes the header to each URL exactly, once each', () => {
    const env = repoAuthEnv(
      [
        'https://github.com/acme/web.git',
        'https://github.com/me/web.git',
        'https://github.com/acme/web.git'
      ],
      't',
      {}
    )
    expect(env).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'http.https://github.com/acme/web.git.extraheader',
      GIT_CONFIG_VALUE_0: header,
      GIT_CONFIG_KEY_1: 'http.https://github.com/me/web.git.extraheader',
      GIT_CONFIG_VALUE_1: header
    })
  })

  it('appends after entries the environment already carries', () => {
    const env = repoAuthEnv(['https://github.com/acme/web'], 't', { GIT_CONFIG_COUNT: '1' })
    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_1).toBe('http.https://github.com/acme/web.extraheader')
  })

  it('adds nothing for no URLs', () => {
    expect(repoAuthEnv([], 't', {})).toEqual({})
  })
})

describe('githubRepoForUrl', () => {
  it('reads owner/name from an HTTPS GitHub URL, with or without .git, ignoring case', () => {
    expect(githubRepoForUrl('https://github.com/Acme/Web.git')).toBe('acme/web')
    expect(githubRepoForUrl('https://github.com/acme/web')).toBe('acme/web')
    expect(githubRepoForUrl('https://github.com/acme/web/')).toBe('acme/web')
    expect(githubRepoForUrl('https://GitHub.com/acme/web.git')).toBe('acme/web')
  })

  it('has nothing for SSH, local, other hosts or plain HTTP', () => {
    expect(githubRepoForUrl('git@github.com:acme/web.git')).toBeNull()
    expect(githubRepoForUrl('ssh://git@github.com/acme/web.git')).toBeNull()
    expect(githubRepoForUrl('file:///tmp/acme/web.git')).toBeNull()
    expect(githubRepoForUrl('/tmp/acme/web.git')).toBeNull()
    expect(githubRepoForUrl('https://gitlab.com/acme/web.git')).toBeNull()
    expect(githubRepoForUrl('https://github.com.evil.test/acme/web.git')).toBeNull()
    expect(githubRepoForUrl('http://github.com/acme/web.git')).toBeNull()
  })

  it('has nothing for a URL that brings its own credentials', () => {
    expect(githubRepoForUrl('https://me@github.com/acme/web.git')).toBeNull()
    expect(githubRepoForUrl('https://me:pat@github.com/acme/web.git')).toBeNull()
  })

  it('has nothing for a path that is not exactly owner/name', () => {
    expect(githubRepoForUrl('https://github.com/acme')).toBeNull()
    expect(githubRepoForUrl('https://github.com/acme/web/tree/main')).toBeNull()
    expect(githubRepoForUrl('https://github.com/')).toBeNull()
  })

  it('matches against the web URL it is given', () => {
    expect(githubRepoForUrl('https://ghe.test/acme/web.git', 'https://ghe.test')).toBe('acme/web')
    expect(githubRepoForUrl('https://github.com/acme/web.git', 'https://ghe.test')).toBeNull()
  })
})

describe('credentials', () => {
  const now = 1_000_000_000_000

  it('works out expiry times from an expiring token', () => {
    const credentials = credentialsFrom(
      {
        kind: 'token',
        token: 'ghu_a',
        expiresIn: 28800,
        refreshToken: 'ghr_a',
        refreshTokenExpiresIn: 15897600
      },
      now
    )
    expect(credentials).toEqual({
      accessToken: 'ghu_a',
      expiresAt: now + 28800_000,
      refreshToken: 'ghr_a',
      refreshExpiresAt: now + 15897600_000
    })
    expect(refreshDue(credentials, now)).toBe(false)
    expect(refreshDue(credentials, now + 28800_000 - REFRESH_MARGIN_MS)).toBe(true)
    expect(canRefresh(credentials, now + 28800_000)).toBe(true)
    expect(canRefresh(credentials, now + 15897600_000)).toBe(false)
  })

  it('never refreshes a token that does not expire', () => {
    const credentials = credentialsFrom({ kind: 'token', token: 'ghu_a' }, now)
    expect(credentials).toEqual(lastingCredentials('ghu_a'))
    expect(refreshDue(credentials, Number.MAX_SAFE_INTEGER)).toBe(false)
    expect(canRefresh(credentials, now)).toBe(false)
  })

  it('round-trips through storage', () => {
    const credentials = credentialsFrom(
      { kind: 'token', token: 'ghu_a', expiresIn: 10, refreshToken: 'ghr_a' },
      now
    )
    expect(parseCredentials(serializeCredentials(credentials))).toEqual(credentials)
  })

  it('reads a bare token, as 3.12 stored it, as one that does not expire', () => {
    expect(parseCredentials('ghu_old\n')).toEqual(lastingCredentials('ghu_old'))
  })

  it('has nothing for an empty or unreadable record', () => {
    expect(parseCredentials('')).toBeNull()
    expect(parseCredentials('{"accessToken":')).toBeNull()
    expect(parseCredentials('{"refreshToken":"ghr_a"}')).toBeNull()
  })
})

describe('installUrl', () => {
  it('points at the app’s installation page', () => {
    expect(installUrl()).toBe('https://github.com/apps/arborist-2/installations/new')
  })
})

describe('childPath', () => {
  it('joins with one separator for the platform', () => {
    expect(childPath('/Users/me/code', 'web', 'darwin')).toBe('/Users/me/code/web')
    expect(childPath('/Users/me/code/', 'web', 'darwin')).toBe('/Users/me/code/web')
    expect(childPath('/', 'web', 'linux')).toBe('/web')
    expect(childPath('C:\\code\\', 'web', 'win32')).toBe('C:\\code\\web')
    expect(childPath('C:\\code', 'web', 'win32')).toBe('C:\\code\\web')
  })
})

describe('projectsByRepo', () => {
  const project = (id: string, name: string): Repository => ({
    id,
    path: `/code/${name}`,
    name,
    addedAt: '2026-01-05T09:00:00.000Z'
  })

  it('matches a repository to the project cloned from it, however its remote is written', () => {
    const repos = [repo(1, 'acme/Web'), repo(2, 'acme/api'), repo(3, 'zaccomode/arborist-2')]
    const projects = [project('a', 'web'), project('b', 'arborist'), project('c', 'scratch')]
    const matches = projectsByRepo(repos, projects, {
      // SSH, different case, with `.git`: still acme/Web.
      a: parseRemoteUrl('git@github.com:ACME/web.git'),
      b: parseRemoteUrl('https://github.com/zaccomode/arborist-2'),
      c: null
    })
    expect([...matches].map(([id, match]) => [id, match.id])).toEqual([
      [1, 'a'],
      [3, 'b']
    ])
  })

  it('does not match the same name on another host', () => {
    const matches = projectsByRepo([repo(1, 'acme/web')], [project('a', 'web')], {
      a: parseRemoteUrl('git@gitlab.com:acme/web.git')
    })
    expect(matches.size).toBe(0)
  })
})
