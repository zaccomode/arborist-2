import { promises as fs } from 'fs'
import { join } from 'path'
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

describe('workingTreeChanges', () => {
  it('reports an unstaged edit and an untracked file', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await fs.writeFile(join(fixture.repoPath, 'new-file.txt'), 'new\n', 'utf8')

    const changes = await service.workingTreeChanges(fixture.repoPath)

    expect(changes.files).toContainEqual(
      expect.objectContaining({ path: 'README.md', kind: 'tracked', index: '.', worktree: 'M' })
    )
    expect(changes.files).toContainEqual(
      expect.objectContaining({ path: 'new-file.txt', kind: 'untracked' })
    )
  }, 30_000)

  it('reports a file staged and unstaged at once', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'staged\n', 'utf8')
    await fixture.git(['add', 'README.md'])
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'staged\nthen edited again\n', 'utf8')

    const changes = await service.workingTreeChanges(fixture.repoPath)

    expect(changes.files).toContainEqual(
      expect.objectContaining({ path: 'README.md', index: 'M', worktree: 'M' })
    )
  }, 30_000)

  it('reports nothing for a clean worktree', async () => {
    const changes = await service.workingTreeChanges(fixture.repoPath)

    expect(changes.files).toEqual([])
  }, 30_000)

  it('orders files alphabetically rather than tracked-before-untracked', async () => {
    // git's own output groups tracked changes before untracked ones, so an
    // untracked file sorting earlier than a tracked one is what this proves.
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await fs.writeFile(join(fixture.repoPath, 'AAA-untracked.txt'), 'new\n', 'utf8')

    const changes = await service.workingTreeChanges(fixture.repoPath)

    expect(changes.files.map((file) => file.path)).toEqual(['AAA-untracked.txt', 'README.md'])
  }, 30_000)
})
