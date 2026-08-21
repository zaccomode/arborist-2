import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  parseAheadBehind,
  parseStatus,
  parseWorktreeList
} from '../../src/main/services/git/porcelain'
import { makeBadgeMatrix, type BadgeMatrix } from './fixtures/git-fixture'

let matrix: BadgeMatrix

beforeAll(async () => {
  matrix = await makeBadgeMatrix()
}, 120_000)

afterAll(async () => {
  await matrix?.fixture.cleanup()
})

describe('the badge matrix, against real git', () => {
  it('lists every worktree, with the repository first', async () => {
    const output = await matrix.fixture.git(['worktree', 'list', '--porcelain'])
    const entries = parseWorktreeList(output)

    expect(entries[0]).toMatchObject({ path: expect.any(String), isMain: true })
    expect(entries.filter((entry) => entry.isMain)).toHaveLength(1)
    // Seven live entries plus the one whose directory was deleted.
    expect(entries).toHaveLength(8)
  })

  it('reads the lock and its reason', async () => {
    const entries = parseWorktreeList(await matrix.fixture.git(['worktree', 'list', '--porcelain']))
    const locked = entries.find((entry) => entry.branch === 'feature/locked')

    expect(locked).toMatchObject({ locked: true, lockReason: 'on an external drive' })
  })

  it('reads a worktree whose directory was deleted as prunable', async () => {
    const entries = parseWorktreeList(await matrix.fixture.git(['worktree', 'list', '--porcelain']))
    const prunable = entries.find((entry) => entry.branch === 'feature/prunable')

    expect(prunable?.prunable).toBe(true)
    expect(prunable?.prunableReason).toBeTruthy()
  })

  it('reads a detached checkout as having no branch', async () => {
    const entries = parseWorktreeList(await matrix.fixture.git(['worktree', 'list', '--porcelain']))
    const detached = entries.find((entry) => entry.path === matrix.paths.detached)

    expect(detached).toMatchObject({ branch: null })
    expect(detached?.head).toHaveLength(40)
  })

  it('counts a branch that is ahead 2 and behind 1', async () => {
    const output = await matrix.fixture.git(
      ['rev-list', '--count', '--left-right', 'HEAD...@{upstream}'],
      matrix.paths.aheadBehind
    )

    expect(parseAheadBehind(output)).toEqual({ ahead: 2, behind: 1 })
  })

  it('sees uncommitted changes in the dirty worktree only', async () => {
    const dirty = parseStatus(
      await matrix.fixture.git(['status', '--porcelain'], matrix.paths.dirty)
    )
    const clean = parseStatus(
      await matrix.fixture.git(['status', '--porcelain'], matrix.paths.aheadBehind)
    )

    expect(dirty.dirty).toBe(true)
    expect(clean.dirty).toBe(false)
  })

  it('reports no upstream at all for a branch that was never pushed', async () => {
    const output = await matrix.fixture.git([
      'for-each-ref',
      '--format=%(upstream:short)\t%(upstream:track)',
      'refs/heads/feature/no-upstream'
    ])

    expect(output.trim()).toBe('')
  })

  it('distinguishes a deleted upstream from one that never existed', async () => {
    const output = await matrix.fixture.git([
      'for-each-ref',
      '--format=%(upstream:short)\t%(upstream:track)',
      'refs/heads/feature/remote-deleted'
    ])

    // The branch still names its upstream, and git marks it gone: the two
    // together are what separate this from a branch that was never pushed.
    expect(output.trim()).toBe('origin/feature/remote-deleted\t[gone]')
  })
})
