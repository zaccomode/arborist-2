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

    const commits = await service.commitLog(fixture.repoPath, ['main'], 10, 0)

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

    // Second and third commit each have exactly one parent; the initial
    // commit, the root, has none.
    expect(commits[0].parents).toEqual([commits[1].hash])
    expect(commits[1].parents).toEqual([commits[2].hash])
    expect(commits[2].parents).toEqual([])
  }, 30_000)

  it('pages with --skip, without duplicating rows', async () => {
    for (let i = 0; i < 5; i++) {
      await fixture.commit(`Commit ${i}`, { [`file-${i}.txt`]: String(i) })
    }

    const first = await service.commitLog(fixture.repoPath, ['main'], 3, 0)
    const second = await service.commitLog(fixture.repoPath, ['main'], 3, 3)

    expect(first).toHaveLength(3)
    expect(second.length).toBeGreaterThan(0)

    const hashes = [...first, ...second].map((commit) => commit.hash)
    expect(new Set(hashes).size).toBe(hashes.length)
  }, 30_000)

  it('reads a remote ref with no local checkout of its own', async () => {
    await fixture.commitFromElsewhere('feature/remote-only', 'Pushed with no local branch')
    await fixture.git(['fetch', 'origin'])

    const commits = await service.commitLog(fixture.repoPath, ['origin/feature/remote-only'], 5, 0)

    expect(commits[0].subject).toBe('Pushed with no local branch')
  }, 30_000)

  it('returns nothing for a range past the end of history', async () => {
    const commits = await service.commitLog(fixture.repoPath, ['main'], 10, 1000)

    expect(commits).toEqual([])
  }, 30_000)

  it('reports two parents, first-parent first, for a merge commit', async () => {
    await fixture.git(['checkout', '-b', 'feature/graph'])
    await fixture.commit('On feature/graph', { 'feature.txt': 'x\n' })
    await fixture.git(['checkout', 'main'])
    await fixture.commit('On main', { 'main.txt': 'x\n' })
    const mainTip = (await fixture.git(['rev-parse', 'main'])).trim()
    const featureTip = (await fixture.git(['rev-parse', 'feature/graph'])).trim()
    await fixture.git(['merge', '--no-ff', 'feature/graph', '-m', 'Merge feature/graph'])

    const commits = await service.commitLog(fixture.repoPath, ['main'], 1, 0)

    expect(commits[0].subject).toBe('Merge feature/graph')
    expect(commits[0].parents).toEqual([mainTip, featureTip])
  }, 30_000)

  it("combines a worktree's branch with its upstream, deduplicating shared history", async () => {
    // main tracks origin/main (set up by `init`); both tips resolve to the
    // same history, so passing both refs must not double up any row.
    await fixture.commit('Ahead of origin', { 'a.txt': 'a\n' })

    const commits = await service.commitLog(fixture.repoPath, ['main', 'origin/main'], 10, 0)

    const hashes = commits.map((commit) => commit.hash)
    expect(new Set(hashes).size).toBe(hashes.length)
    expect(commits[0].subject).toBe('Ahead of origin')
  }, 30_000)

  it('accepts a branch named like a path, thanks to the trailing --', async () => {
    await fixture.git(['checkout', '-b', 'feature/nested/topic'])
    await fixture.commit('On a slash-nested branch', { 'nested.txt': 'x\n' })

    const commits = await service.commitLog(fixture.repoPath, ['feature/nested/topic'], 5, 0)

    expect(commits[0].subject).toBe('On a slash-nested branch')
  }, 30_000)
})

describe('commitFiles', () => {
  it('reads numstat for an ordinary commit', async () => {
    const hash = await fixture.commit('Add and edit files', {
      'a.txt': 'a\nb\nc\n',
      'b.txt': 'x\n'
    })

    const files = await service.commitFiles(fixture.repoPath, hash)

    const byPath = Object.fromEntries(files.map((file) => [file.path, file]))
    expect(byPath['a.txt']).toMatchObject({ origPath: null, binary: false })
    expect(byPath['a.txt'].insertions).toBeGreaterThan(0)
    expect(byPath['b.txt']).toMatchObject({ origPath: null, binary: false })
  }, 30_000)

  it('reads a rename with -M, old and new path both present', async () => {
    await fixture.commit('Add original.txt', { 'original.txt': 'line one\nline two\n' })
    await fixture.git(['mv', 'original.txt', 'renamed.txt'])
    await fixture.git(['commit', '-m', 'Rename original.txt'])
    const hash = (await fixture.git(['rev-parse', 'HEAD'])).trim()

    const files = await service.commitFiles(fixture.repoPath, hash)

    expect(files).toEqual([
      expect.objectContaining({ path: 'renamed.txt', origPath: 'original.txt', binary: false })
    ])
  }, 30_000)

  it('only shows the first-parent diff of a merge, per --diff-merges=first-parent', async () => {
    await fixture.git(['checkout', '-b', 'feature/files'])
    await fixture.commit('Feature-only file', { 'feature-only.txt': 'x\n' })
    await fixture.git(['checkout', 'main'])
    await fixture.commit('Main-only file', { 'main-only.txt': 'x\n' })
    await fixture.git(['merge', '--no-ff', 'feature/files', '-m', 'Merge feature/files'])
    const mergeHash = (await fixture.git(['rev-parse', 'HEAD'])).trim()

    const files = await service.commitFiles(fixture.repoPath, mergeHash)

    // A merge diffed against its first parent alone shows only what the
    // second parent (the feature branch) brought in, not main's own commit.
    expect(files.map((file) => file.path)).toEqual(['feature-only.txt'])
  }, 30_000)
})
