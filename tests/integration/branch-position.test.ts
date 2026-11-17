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

describe('branchPosition (#151), against a bare-remote fixture', () => {
  it('counts a worktree branch ahead of and behind origin/main', async () => {
    const path = await fixture.addWorktree('feature', { branch: 'feature/thing' })
    await fixture.commit('One', { 'one.txt': '1' }, path)
    await fixture.commit('Two', { 'two.txt': '2' }, path)
    // main moves on, on the remote, the way a merged PR would.
    await fixture.commitFromElsewhere('main', 'Merged elsewhere')
    await service.fetchAll(fixture.repoPath)

    expect(await service.branchPosition(fixture.repoPath, 'feature/thing')).toEqual({
      base: 'origin/main',
      ahead: 2,
      behind: 1
    })
  }, 30_000)

  it('counts a remote branch with no worktree of its own', async () => {
    await fixture.commitFromElsewhere('feature-x', 'Pushed from elsewhere')
    await service.fetchAll(fixture.repoPath)

    expect(await service.branchPosition(fixture.repoPath, 'origin/feature-x')).toEqual({
      base: 'origin/main',
      ahead: 1,
      behind: 0
    })
  }, 30_000)

  it('counts a detached commit', async () => {
    const head = await fixture.commit('On main', { 'x.txt': 'x' })

    expect(await service.branchPosition(fixture.repoPath, head)).toEqual({
      base: 'origin/main',
      ahead: 1,
      behind: 0
    })
  }, 30_000)

  it('has nothing to say about the default branch itself, locally or on the remote', async () => {
    expect(await service.branchPosition(fixture.repoPath, 'main')).toBeNull()
    expect(await service.branchPosition(fixture.repoPath, 'origin/main')).toBeNull()
  }, 30_000)

  it('falls back to the local default branch when there is no remote copy', async () => {
    await fixture.git(['remote', 'remove', 'origin'])
    await fixture.addWorktree('feature', { branch: 'feature/local' })

    expect(await service.branchPosition(fixture.repoPath, 'feature/local')).toEqual({
      base: 'main',
      ahead: 0,
      behind: 0
    })
  }, 30_000)

  it('returns null for a ref that does not resolve, or reads as an option', async () => {
    expect(await service.branchPosition(fixture.repoPath, 'no-such-branch')).toBeNull()
    expect(await service.branchPosition(fixture.repoPath, '--output=x')).toBeNull()
  }, 30_000)

  it('comes with the worktree list, for every worktree off the default branch', async () => {
    const feature = await fixture.addWorktree('feature', { branch: 'feature/thing' })
    await fixture.commit('One', { 'one.txt': '1' }, feature)
    await fixture.addWorktree('detached', { detach: true })
    await fixture.commitFromElsewhere('main', 'Merged elsewhere')
    await service.fetchAll(fixture.repoPath)

    const worktrees = await service.listWorktrees(fixture.repoPath)
    const byBranch = new Map(worktrees.map((w) => [w.branch ?? 'detached', w.position]))

    expect(byBranch.get('main')).toBeNull()
    expect(byBranch.get('feature/thing')).toEqual({ base: 'origin/main', ahead: 1, behind: 1 })
    expect(byBranch.get('detached')).toEqual({ base: 'origin/main', ahead: 0, behind: 1 })
  }, 30_000)
})
