import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
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

describe('fetchAll, against a bare-remote fixture', () => {
  it('picks up a push made from elsewhere', async () => {
    await fixture.commitFromElsewhere('main', 'Pushed while nobody was fetching')

    await service.fetchAll(fixture.repoPath)

    const [main] = await service.listWorktrees(fixture.repoPath)
    expect(main.status).toMatchObject({ behind: 1, ahead: 0 })
  }, 30_000)

  it('flags a tracking worktree remote-deleted once the branch is deleted and fetched', async () => {
    const path = await fixture.addWorktree('feature', { branch: 'feature/gone' })
    await fixture.git(['push', '--set-upstream', 'origin', 'feature/gone'], path)

    // Deleted from a second clone, the way a colleague's deletion would
    // arrive: git updates the local remote-tracking ref of a push it made
    // itself, so deleting from the fixture's own repo would make the branch
    // look gone with no fetch involved at all.
    const elsewhere = join(fixture.root, 'elsewhere-delete')
    await fixture.git(['clone', fixture.remotePath, elsewhere], fixture.root)
    await fixture.git(['push', 'origin', '--delete', 'feature/gone'], elsewhere)

    const before = (await service.listWorktrees(fixture.repoPath)).find((w) => w.path === path)
    expect(before?.status?.gone).toBe(false)

    await service.fetchAll(fixture.repoPath)

    const after = (await service.listWorktrees(fixture.repoPath)).find((w) => w.path === path)
    expect(after?.status?.gone).toBe(true)
  }, 30_000)

  it('fails within the timeout, rather than hanging, against an unreachable remote', async () => {
    await fixture.git(['remote', 'set-url', 'origin', 'https://127.0.0.1:1/nope.git'])

    await expect(service.fetchAll(fixture.repoPath)).rejects.toThrow()
  }, 30_000)
})
