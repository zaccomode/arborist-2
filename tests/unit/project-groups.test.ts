import { describe, expect, it } from 'vitest'
import type { Repository } from '@shared/persisted'
import { groupLabel, groupProjects, parseRemoteUrl, pickRemoteUrl } from '@shared/project-groups'

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
      '1': 'git@github.com:Zaccomode/zeta.git',
      '2': 'https://github.com/zaccomode/alpha',
      '3': null,
      '4': 'https://github.com/acme/beta.git',
      '5': 'git@gitlab.com:acme/mirror.git'
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
      '1': 'https://github.com/Local/a',
      '2': null
    })
    expect(groups.map((group) => [group.label, group.local])).toEqual([
      ['Local', false],
      ['Local', true]
    ])
  })
})

describe('pickRemoteUrl', () => {
  it("prefers origin's URL, then the first remote's", () => {
    expect(
      pickRemoteUrl(
        'remote.fork.url git@github.com:me/x.git\nremote.origin.url https://github.com/o/x\n'
      )
    ).toBe('https://github.com/o/x')
    expect(pickRemoteUrl('remote.fork.url git@github.com:me/x.git\n')).toBe(
      'git@github.com:me/x.git'
    )
    expect(pickRemoteUrl('')).toBeNull()
  })
})
