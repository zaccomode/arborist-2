import { describe, expect, it } from 'vitest'
import {
  cloneUrlFor,
  filterRepos,
  gitAuthEnv,
  groupReposByOwner,
  installUrl,
  interpretTokenPoll,
  nextPollInterval,
  repoNameFor,
  sortOwners,
  sortRepos,
  type GitHubRepo
} from '@shared/github'
import { childPath } from '@shared/paths'

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
