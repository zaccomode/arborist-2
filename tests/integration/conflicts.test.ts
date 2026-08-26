import { promises as fs } from 'fs'
import { join } from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import {
  makeConflictFixture,
  makeFixtureRepo,
  type ConflictFixture,
  type GitFixture
} from './fixtures/git-fixture'

const service = new GitService(new GitRunner(new GitLocator()))

let fixture: GitFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

describe('conflictState — merge', () => {
  let c: ConflictFixture

  async function setUp(): Promise<void> {
    c = await makeConflictFixture()
    fixture = c.fixture
  }

  it('detects a merge in progress, naming both sides', async () => {
    await setUp()
    const state = await service.conflictState(c.worktreePath)
    expect(state).toEqual({
      operation: 'merge',
      sourceLabel: 'main',
      targetLabel: 'feature/conflict'
    })
  }, 30_000)

  it('resolves nothing false-positive on an ordinary clean worktree', async () => {
    fixture = await makeFixtureRepo()
    const state = await service.conflictState(fixture.repoPath)
    expect(state).toEqual({ operation: null, sourceLabel: null, targetLabel: null })
  }, 30_000)

  it('keepOurs resolves a UU conflict to our side and stages it', async () => {
    await setUp()
    await service.keepOurs(c.worktreePath, 'uu.txt')

    // Normalised because `core.autocrlf` restores CRLF on checkout on
    // Windows: what this asserts is which side won, not which line ending
    // the platform writes it with — see `discardFiles`'s test in
    // staging.test.ts for the same normalisation.
    const content = await fs.readFile(join(c.worktreePath, 'uu.txt'), 'utf8')
    expect(content.replace(/\r\n/g, '\n')).toBe('feature\n')

    const changes = await service.workingTreeChanges(c.worktreePath)
    expect(changes.files.find((file) => file.path === 'uu.txt')).toBeUndefined()
  }, 30_000)

  it('abortConflict backs out the merge entirely', async () => {
    await setUp()
    await service.abortConflict(c.worktreePath, 'merge')

    const changes = await service.workingTreeChanges(c.worktreePath)
    expect(changes.files.some((file) => file.kind === 'unmerged')).toBe(false)

    const state = await service.conflictState(c.worktreePath)
    expect(state.operation).toBeNull()
  }, 30_000)

  it('continueConflict finishes the merge once every conflict is resolved, without hanging on the editor', async () => {
    await setUp()
    await service.keepOurs(c.worktreePath, 'uu.txt')
    await service.stageFiles(c.worktreePath, ['aa.txt'])

    await service.continueConflict(c.worktreePath, 'merge')

    const state = await service.conflictState(c.worktreePath)
    expect(state.operation).toBeNull()

    const changes = await service.workingTreeChanges(c.worktreePath)
    expect(changes.files.length).toBe(0)
  }, 30_000)
})

describe('conflictState — rebase, cherry-pick, revert', () => {
  it('detects a rebase in progress, naming the branch and what it is landing on', async () => {
    fixture = await makeFixtureRepo()
    const f = fixture
    const worktreePath = await f.addWorktree('rebase-conflict', { branch: 'feature/rebase' })
    await f.commit('Feature edits r.txt', { 'r.txt': 'feature\n' }, worktreePath)
    await f.commit('Main edits r.txt', { 'r.txt': 'main\n' })

    await f.git(['rebase', 'main'], worktreePath).catch(() => {
      // A rebase conflict exits non-zero; that is the point of this test.
    })

    const state = await service.conflictState(worktreePath)
    expect(state.operation).toBe('rebase')
    expect(state.targetLabel).toBe('feature/rebase')
  }, 30_000)

  it('detects a cherry-pick in progress', async () => {
    fixture = await makeFixtureRepo()
    const f = fixture
    const worktreePath = await f.addWorktree('cherry-pick-conflict', { branch: 'feature/cp' })
    await f.commit('Feature edits c.txt', { 'c.txt': 'feature\n' }, worktreePath)
    const mainSha = await f.commit('Main edits c.txt', { 'c.txt': 'main\n' })

    await f.git(['cherry-pick', mainSha], worktreePath).catch(() => {
      // A cherry-pick conflict exits non-zero; that is the point of this test.
    })

    const state = await service.conflictState(worktreePath)
    expect(state.operation).toBe('cherry-pick')
    expect(state.sourceLabel).toBeTruthy()

    await service.abortConflict(worktreePath, 'cherry-pick')
    expect((await service.conflictState(worktreePath)).operation).toBeNull()
  }, 30_000)

  it('detects a revert in progress', async () => {
    fixture = await makeFixtureRepo()
    const f = fixture
    const addSha = await f.commit('Add v.txt', { 'v.txt': 'v1\n' })
    await f.commit('Edit v.txt', { 'v.txt': 'v2\n' })

    await f.git(['revert', '--no-edit', addSha]).catch(() => {
      // Reverting the add conflicts with the edit that followed it.
    })

    const state = await service.conflictState(f.repoPath)
    expect(state.operation).toBe('revert')

    await service.abortConflict(f.repoPath, 'revert')
    expect((await service.conflictState(f.repoPath)).operation).toBeNull()
  }, 30_000)
})
