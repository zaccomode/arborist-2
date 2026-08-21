import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Worktree } from '../../src/shared/domain'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import { makeBadgeMatrix, type BadgeMatrix } from './fixtures/git-fixture'

const service = new GitService(new GitRunner(new GitLocator()))

let matrix: BadgeMatrix
let worktrees: Worktree[]

function at(path: string): Worktree {
  const found = worktrees.find((worktree) => worktree.path === path)
  if (!found)
    throw new Error(`No worktree at ${path} in ${worktrees.map((w) => w.path).join(', ')}`)
  return found
}

beforeAll(async () => {
  matrix = await makeBadgeMatrix()
  worktrees = await service.listWorktrees(matrix.fixture.repoPath)
}, 120_000)

afterAll(async () => {
  await matrix?.fixture.cleanup()
})

describe('the refresh pipeline, against the badge matrix', () => {
  it('annotates the repository worktree', () => {
    const main = at(matrix.paths.main)

    expect(main.isMain).toBe(true)
    expect(main.branch).toBe('main')
    expect(main.status?.upstream).toBe('origin/main')
    expect(main.status?.dirty).toBe(false)
  })

  it('counts a branch ahead 2 and behind 1', () => {
    expect(at(matrix.paths.aheadBehind).status).toMatchObject({
      upstream: 'origin/feature/ahead-behind',
      ahead: 2,
      behind: 1,
      gone: false,
      dirty: false
    })
  })

  it('sees the uncommitted change', () => {
    expect(at(matrix.paths.dirty).status).toMatchObject({ dirty: true, unstaged: 1 })
  })

  it('reports no upstream for a branch that was never pushed', () => {
    expect(at(matrix.paths.noUpstream).status).toMatchObject({
      upstream: null,
      gone: false,
      ahead: 0,
      behind: 0
    })
  })

  it('marks an upstream deleted on the remote as gone', () => {
    expect(at(matrix.paths.remoteDeleted).status).toMatchObject({
      upstream: 'origin/feature/remote-deleted',
      gone: true
    })
  })

  it('carries the lock and its reason through', () => {
    expect(at(matrix.paths.locked)).toMatchObject({
      locked: true,
      lockReason: 'on an external drive'
    })
  })

  it('marks the missing directory prunable without trying to enrich it', () => {
    const prunable = at(matrix.paths.prunable)

    expect(prunable.prunable).toBe(true)
    expect(prunable.statusError).toBeNull()
    expect(prunable.status?.lastCommit).toBeNull()
  })

  it('reads a detached checkout with its commit but no upstream', () => {
    const detached = at(matrix.paths.detached)

    expect(detached.branch).toBeNull()
    expect(detached.status?.upstream).toBeNull()
    expect(detached.status?.lastCommit?.subject).toBe('Initial commit')
  })

  it('reads the last commit for the sidebar metadata line', () => {
    const commit = at(matrix.paths.aheadBehind).status?.lastCommit

    expect(commit).toMatchObject({ author: 'Arborist Fixture', subject: 'Ahead two' })
    expect(commit?.shortHash).toHaveLength(7)
    expect(Number.isNaN(Date.parse(commit!.date))).toBe(false)
  })

  it('enriches every worktree, whatever the concurrency limit', async () => {
    const serial = await service.listWorktrees(matrix.fixture.repoPath, 1)

    expect(serial).toHaveLength(worktrees.length)
    expect(serial.map((worktree) => worktree.status?.dirty)).toEqual(
      worktrees.map((worktree) => worktree.status?.dirty)
    )
  })
})
