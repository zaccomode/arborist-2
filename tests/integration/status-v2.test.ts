import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { WorkingTreeChanges, WorkingTreeStatus } from '../../src/shared/domain'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { countsFromV2, parseStatus, parseStatusV2 } from '../../src/main/services/git/porcelain'
import {
  makeBadgeMatrix,
  makeConflictFixture,
  makeStatusV2Fixture,
  type BadgeMatrix,
  type ConflictFixture,
  type StatusV2Fixture
} from './fixtures/git-fixture'

const runner = new GitRunner(new GitLocator())

async function statusV2(repoPath: string): Promise<WorkingTreeChanges> {
  const result = await runner.run(
    ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'],
    { repoPath }
  )
  return parseStatusV2(result.stdout)
}

async function statusV1(repoPath: string): Promise<WorkingTreeStatus> {
  const result = await runner.run(['status', '--porcelain', '--untracked-files=all'], { repoPath })
  return parseStatus(result.stdout)
}

describe('parseStatusV2 against real git output', () => {
  let f: StatusV2Fixture

  beforeAll(async () => {
    f = await makeStatusV2Fixture()
  }, 60_000)

  afterAll(async () => {
    await f.fixture.cleanup()
  })

  it('reports the staged rename with a space in both paths', async () => {
    const changes = await statusV2(f.repoPath)
    const renamed = changes.files.find((file) => file.path === 'new file.txt')

    expect(renamed).toMatchObject({
      kind: 'tracked',
      index: 'R',
      origPath: 'old file.txt',
      score: 100
    })
  })

  it('reports the unstaged CRLF edit', async () => {
    const changes = await statusV2(f.repoPath)
    const crlf = changes.files.find((file) => file.path === 'crlf.txt')

    expect(crlf).toMatchObject({ kind: 'tracked', index: '.', worktree: 'M' })
  })

  it('reports the unstaged latin-1 edit', async () => {
    const changes = await statusV2(f.repoPath)
    const latin1 = changes.files.find((file) => file.path === 'latin1.txt')

    expect(latin1).toMatchObject({ kind: 'tracked', index: '.', worktree: 'M' })
  })

  it('reports branch info for the checked-out branch', async () => {
    const changes = await statusV2(f.repoPath)

    expect(changes.branch.head).toBe('main')
    expect(changes.branch.detached).toBe(false)
    expect(changes.branch.oid).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('parseStatusV2 against a real conflict', () => {
  let c: ConflictFixture

  beforeAll(async () => {
    c = await makeConflictFixture()
  }, 60_000)

  afterAll(async () => {
    await c.fixture.cleanup()
  })

  it('reports a UU and an AA record', async () => {
    const changes = await statusV2(c.worktreePath)
    const codes = changes.files.map((file) => [file.path, file.conflict]).sort()

    expect(codes).toEqual([
      ['aa.txt', 'AA'],
      ['uu.txt', 'UU']
    ])
  })
})

describe('countsFromV2 parity with parseStatus, over the badge matrix', () => {
  let matrix: BadgeMatrix

  beforeAll(async () => {
    matrix = await makeBadgeMatrix()
  }, 120_000)

  afterAll(async () => {
    await matrix.fixture.cleanup()
  })

  const cases: Array<[name: string, key: keyof BadgeMatrix['paths']]> = [
    ['clean, tracking', 'main'],
    ['ahead 2 / behind 1', 'aheadBehind'],
    ['dirty', 'dirty'],
    ['no upstream', 'noUpstream'],
    ['remote deleted', 'remoteDeleted'],
    ['locked', 'locked'],
    ['detached', 'detached']
  ]

  it.each(cases)('matches for the %s worktree', async (_name, key) => {
    const path = matrix.paths[key]
    const [v1, v2] = await Promise.all([statusV1(path), statusV2(path)])

    expect(countsFromV2(v2)).toEqual(v1)
  })
})

describe('the byte-accuracy invariant', () => {
  let f: StatusV2Fixture

  beforeAll(async () => {
    f = await makeStatusV2Fixture()
  }, 60_000)

  afterAll(async () => {
    await f.fixture.cleanup()
  })

  it('applies a latin-1 patch from raw bytes, but not from a round-tripped string', async () => {
    const diff = await runner.runRaw(['diff', '--', 'latin1.txt'], { repoPath: f.repoPath })
    expect(diff.stdoutBuffer.length).toBeGreaterThan(0)

    const fromBytes = await runner.run(['apply', '--cached', '--check'], {
      repoPath: f.repoPath,
      input: diff.stdoutBuffer
    })
    expect(fromBytes.exitCode).toBe(0)

    // Decoding then re-encoding is where the invalid byte turns into the
    // three-byte U+FFFD replacement character, so the round-tripped patch is
    // provably different bytes from the original.
    const roundTripped = Buffer.from(diff.stdoutBuffer.toString('utf8'), 'utf8')
    expect(roundTripped.equals(diff.stdoutBuffer)).toBe(false)

    const fromString = await runner.run(['apply', '--cached', '--check'], {
      repoPath: f.repoPath,
      input: roundTripped
    })
    expect(fromString.exitCode).not.toBe(0)
  })

  it('runRaw always returns a stdoutBuffer', async () => {
    const result = await runner.runRaw(['status', '--porcelain=v2', '-z'], {
      repoPath: f.repoPath
    })

    expect(Buffer.isBuffer(result.stdoutBuffer)).toBe(true)
    expect(result.stdoutBuffer.toString('utf8')).toBe(result.stdout)
  })

  it('does not hang when a command reads stdin and none is given', async () => {
    // `git apply` with no file argument reads a patch from stdin; closing
    // stdin immediately is what stops this from hanging until the timeout.
    const result = await runner.run(['apply', '--check'], {
      repoPath: f.repoPath,
      timeoutMs: 5_000
    })

    expect(result.exitCode).not.toBe(0)
  })
})
