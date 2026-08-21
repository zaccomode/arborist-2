import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import { makeFixtureRepo, type GitFixture } from './fixtures/git-fixture'

const service = new GitService(new GitRunner(new GitLocator()))

let fixture: GitFixture

beforeEach(async () => {
  fixture = await makeFixtureRepo()
}, 60_000)

afterEach(async () => {
  await fixture?.cleanup()
})

describe('commitLog', () => {
  it('matches git log for a fixture with known stats', async () => {
    await fixture.commit('Second commit', { 'a.txt': 'a\nb\n' })
    await fixture.commit('Third commit', { 'a.txt': 'a\nb\nc\n', 'b.txt': 'x\n' })

    const commits = await service.commitLog(fixture.repoPath, 'main', 10, 0)

    expect(commits.map((commit) => commit.subject)).toEqual([
      'Third commit',
      'Second commit',
      'Initial commit'
    ])
    expect(commits[0]).toMatchObject({ filesChanged: 2, author: 'Arborist Fixture' })
    expect(commits[0].insertions).toBeGreaterThan(0)

    const head = (await fixture.git(['rev-parse', 'HEAD'])).trim()
    expect(commits[0].hash).toBe(head)
    expect(head.startsWith(commits[0].shortHash)).toBe(true)
  }, 30_000)

  it('pages with --skip, without duplicating rows', async () => {
    for (let i = 0; i < 5; i++) {
      await fixture.commit(`Commit ${i}`, { [`file-${i}.txt`]: String(i) })
    }

    const first = await service.commitLog(fixture.repoPath, 'main', 3, 0)
    const second = await service.commitLog(fixture.repoPath, 'main', 3, 3)

    expect(first).toHaveLength(3)
    expect(second.length).toBeGreaterThan(0)

    const hashes = [...first, ...second].map((commit) => commit.hash)
    expect(new Set(hashes).size).toBe(hashes.length)
  }, 30_000)

  it('reads a remote ref with no local checkout of its own', async () => {
    await fixture.commitFromElsewhere('feature/remote-only', 'Pushed with no local branch')
    await fixture.git(['fetch', 'origin'])

    const commits = await service.commitLog(fixture.repoPath, 'origin/feature/remote-only', 5, 0)

    expect(commits[0].subject).toBe('Pushed with no local branch')
  }, 30_000)

  it('returns nothing for a range past the end of history', async () => {
    const commits = await service.commitLog(fixture.repoPath, 'main', 10, 1000)

    expect(commits).toEqual([])
  }, 30_000)
})
