import { describe, expect, it } from 'vitest'
import type { Repository } from '@shared/persisted'
import {
  groupLabel,
  groupProjects,
  isResolvableSshHost,
  parseRemoteUrl,
  parseSshHostname,
  pickRemoteName,
  resolveRemoteLocation,
  splitRemoteUrl,
  sshHostOf,
  type RemoteLocation
} from '@shared/project-groups'

describe('parseRemoteUrl', () => {
  it('reads HTTPS, SSH and scp-like GitHub URLs', () => {
    const expected = { host: 'github.com', owner: 'zaccomode' }
    expect(parseRemoteUrl('https://github.com/zaccomode/arborist-2.git')).toEqual(expected)
    expect(parseRemoteUrl('https://user:token@GitHub.com/zaccomode/arborist-2')).toEqual(expected)
    expect(parseRemoteUrl('ssh://git@github.com:22/zaccomode/arborist-2.git')).toEqual(expected)
    expect(parseRemoteUrl('git@github.com:zaccomode/arborist-2.git')).toEqual(expected)
  })

  it('takes the top-level namespace on hosts with subgroups', () => {
    expect(parseRemoteUrl('git@gitlab.com:team/sub/repo.git')).toEqual({
      host: 'gitlab.com',
      owner: 'team'
    })
  })

  it('has no owner when the repository sits at the root of the host', () => {
    expect(parseRemoteUrl('https://git.example.com/repo.git')).toEqual({
      host: 'git.example.com',
      owner: null
    })
  })

  it('keeps every part of a credential out of the result (#166)', () => {
    for (const url of [
      'https://user:s3cr3t-token@github.com/acme/x.git',
      // Unencoded `/` and `@` in the password, which used to split the
      // authority early and group as "ss@github.com (user:pa)".
      'https://user:pa/ss@github.com/acme/x.git',
      'https://user:p@ss/w@rd@github.com/acme/x.git',
      'ssh://user:pa/ss@github.com:22/acme/x.git'
    ]) {
      const location = parseRemoteUrl(url)
      expect(location, url).toEqual({ host: 'github.com', owner: 'acme' })
      const label = groupLabel(location)
      for (const secret of ['user', 's3cr3t', 'pa', 'ss', 'rd']) {
        expect(label, url).not.toContain(secret)
      }
    }
  })

  it('treats ssh.github.com, GitHub over port 443, as GitHub (#166)', () => {
    expect(parseRemoteUrl('ssh://git@ssh.github.com:443/acme/x')).toEqual({
      host: 'github.com',
      owner: 'acme'
    })
  })

  it('resolves an SSH host alias, and only an SSH one (#166)', () => {
    const resolve = (host: string): string => (host === 'github-work' ? 'github.com' : host)
    expect(parseRemoteUrl('git@github-work:acme/x.git', resolve)).toEqual({
      host: 'github.com',
      owner: 'acme'
    })
    expect(parseRemoteUrl('ssh://git@github-work/acme/x.git', resolve)).toEqual({
      host: 'github.com',
      owner: 'acme'
    })
    // An alias that resolves to GitHub's port-443 endpoint is GitHub too.
    expect(parseRemoteUrl('git@gh443:acme/x.git', () => 'ssh.github.com')?.host).toBe('github.com')
    // ssh config has no say over an HTTPS URL.
    expect(parseRemoteUrl('https://github-work/acme/x', resolve)?.host).toBe('github-work')
  })

  it('has no owner for an absolute path on an scp-like host (#166)', () => {
    expect(parseRemoteUrl('git@host:/srv/repo.git')).toEqual({ host: 'host', owner: null })
    expect(parseRemoteUrl('git@host:/srv/team/repo.git')).toEqual({ host: 'host', owner: null })
  })

  it('treats local paths and file URLs as no remote at all', () => {
    expect(parseRemoteUrl('/srv/git/repo.git')).toBeNull()
    expect(parseRemoteUrl('../repo')).toBeNull()
    expect(parseRemoteUrl('C:\\repos\\thing')).toBeNull()
    expect(parseRemoteUrl('C:/repos/thing')).toBeNull()
    expect(parseRemoteUrl('file:///srv/git/repo.git')).toBeNull()
    expect(parseRemoteUrl('')).toBeNull()
  })
})

describe('groupLabel', () => {
  it('names a GitHub group by owner alone, other hosts by owner and host', () => {
    expect(groupLabel({ host: 'github.com', owner: 'acme' })).toBe('acme')
    expect(groupLabel({ host: 'gitlab.com', owner: 'acme' })).toBe('acme (gitlab.com)')
    expect(groupLabel({ host: 'git.example.com', owner: null })).toBe('git.example.com')
    expect(groupLabel(null)).toBe('Local')
  })
})

describe('groupProjects', () => {
  const project = (id: string, name: string): Repository => ({
    id,
    name,
    path: `/repos/${name}`,
    addedAt: '2026-01-01T00:00:00.000Z'
  })

  it('groups by owner, alphabetically, with Local last and projects sorted within', () => {
    const projects = [
      project('1', 'zeta'),
      project('2', 'alpha'),
      project('3', 'scratch'),
      project('4', 'beta'),
      project('5', 'mirror')
    ]
    const groups = groupProjects(projects, {
      '1': parseRemoteUrl('git@github.com:Zaccomode/zeta.git'),
      '2': parseRemoteUrl('https://github.com/zaccomode/alpha'),
      '3': null,
      '4': parseRemoteUrl('https://github.com/acme/beta.git'),
      '5': parseRemoteUrl('git@gitlab.com:acme/mirror.git')
    })
    expect(groups.map((group) => [group.label, group.projects.map((p) => p.name)])).toEqual([
      ['acme', ['beta']],
      ['acme (gitlab.com)', ['mirror']],
      ['zaccomode', ['alpha', 'zeta']],
      ['Local', ['scratch']]
    ])
  })

  it('treats a project with no known URL as local', () => {
    expect(groupProjects([project('1', 'a')], {})).toEqual([
      { label: 'Local', local: true, projects: [project('1', 'a')] }
    ])
  })

  it('keeps an owner called Local apart from the Local group', () => {
    const groups = groupProjects([project('1', 'a'), project('2', 'b')], {
      '1': { host: 'github.com', owner: 'Local' } satisfies RemoteLocation,
      '2': null
    })
    expect(groups.map((group) => [group.label, group.local])).toEqual([
      ['Local', false],
      ['Local', true]
    ])
  })
})

describe('pickRemoteName', () => {
  it('prefers origin, then the first remote', () => {
    expect(
      pickRemoteName(
        'remote.fork.url git@github.com:me/x.git\nremote.origin.url https://github.com/o/x\n'
      )
    ).toBe('origin')
    expect(pickRemoteName('remote.fork.url git@github.com:me/x.git\r\n')).toBe('fork')
    expect(pickRemoteName('')).toBeNull()
  })
})

describe('sshHostOf', () => {
  it('reads the host of scp-like and ssh:// URLs as written', () => {
    expect(sshHostOf('git@github-work:acme/x.git')).toBe('github-work')
    expect(sshHostOf('ssh://git@ssh.github.com:443/acme/x')).toBe('ssh.github.com')
    expect(sshHostOf('git+ssh://host/acme/x')).toBe('host')
  })

  it('is null for anything git does not reach over SSH', () => {
    expect(sshHostOf('https://github.com/acme/x')).toBeNull()
    expect(sshHostOf('/srv/repo.git')).toBeNull()
    expect(sshHostOf('C:\\repos\\x')).toBeNull()
    expect(sshHostOf('file:///srv/repo.git')).toBeNull()
  })
})

describe('splitRemoteUrl (#168)', () => {
  it('splits each network form into host, path and whether it is SSH', () => {
    expect(splitRemoteUrl('git@github-work:acme/x.git')).toEqual({
      host: 'github-work',
      path: 'acme/x.git',
      ssh: true
    })
    expect(splitRemoteUrl('SSH://git@host:22/acme/x')).toEqual({
      host: 'host',
      path: 'acme/x',
      ssh: true
    })
    expect(splitRemoteUrl('https://u:p@ss/w@github.com/acme/x')).toEqual({
      host: 'github.com',
      path: 'acme/x',
      ssh: false
    })
    expect(splitRemoteUrl('git@host:/srv/repo.git')).toEqual({ host: 'host', path: '', ssh: true })
  })

  it('is null for local paths, file:// URLs and URLs with no host', () => {
    expect(splitRemoteUrl('/srv/repo.git')).toBeNull()
    expect(splitRemoteUrl('C:\\repos\\x')).toBeNull()
    expect(splitRemoteUrl('file:///srv/repo.git')).toBeNull()
    expect(splitRemoteUrl('ssh:///acme/x')).toBeNull()
    expect(splitRemoteUrl('  ')).toBeNull()
  })

  it('agrees with sshHostOf and parseRemoteUrl on the host it looks up and replaces', () => {
    const urls = [
      'git@github-work:acme/x.git',
      'ssh://git@github-work:2222/acme/x',
      'git+ssh://u:p@ss@github-work/acme/x',
      'https://github-work/acme/x'
    ]
    for (const url of urls) {
      const looked: string[] = []
      const location = parseRemoteUrl(url, (host) => {
        looked.push(host)
        return 'resolved.example'
      })
      const ssh = sshHostOf(url)
      expect(looked).toEqual(ssh ? [ssh] : [])
      expect(location?.host).toBe(ssh ? 'resolved.example' : 'github-work')
    }
  })
})

describe('isResolvableSshHost', () => {
  it('accepts host names and refuses anything ssh could read as an option', () => {
    expect(isResolvableSshHost('github-work')).toBe(true)
    expect(isResolvableSshHost('git.example.com')).toBe(true)
    expect(isResolvableSshHost('-oProxyCommand=evil')).toBe(false)
    expect(isResolvableSshHost('host name')).toBe(false)
    expect(isResolvableSshHost('')).toBe(false)
  })
})

describe('parseSshHostname', () => {
  it('reads the hostname line of ssh -G output', () => {
    expect(parseSshHostname('user git\nhostname github.com\nport 22\n')).toBe('github.com')
    expect(parseSshHostname('user git\r\nhostname github.com\r\n')).toBe('github.com')
    expect(parseSshHostname('user git\n')).toBeNull()
  })
})

describe('resolveRemoteLocation', () => {
  it('looks up only SSH hosts', async () => {
    const lookups: string[] = []
    const lookup = async (host: string): Promise<string> => {
      lookups.push(host)
      return host === 'github-work' ? 'github.com' : host
    }
    expect(await resolveRemoteLocation('git@github-work:acme/x.git', lookup)).toEqual({
      host: 'github.com',
      owner: 'acme'
    })
    expect(await resolveRemoteLocation('https://github.com/acme/x', lookup)).toEqual({
      host: 'github.com',
      owner: 'acme'
    })
    expect(await resolveRemoteLocation(null, lookup)).toBeNull()
    expect(lookups).toEqual(['github-work'])
  })
})
