import { describe, it, expect } from 'vitest'
import {
  resolveWorktreeLocation,
  rootConflictsWithProject,
  worktreeBasePath
} from '../../src/shared/worktree-location'

describe('resolveWorktreeLocation', () => {
  const beside = { worktreeLocation: 'beside' as const, worktreeRoot: null }
  const central = { worktreeLocation: 'central' as const, worktreeRoot: '/Volumes/External/wt' }

  it('resolves to the app level when the project has no override', () => {
    expect(resolveWorktreeLocation(central, undefined)).toEqual({
      mode: 'central',
      root: '/Volumes/External/wt'
    })
    expect(resolveWorktreeLocation(beside, undefined)).toEqual({ mode: 'beside', root: null })
  })

  it('resolves to the app level when the project explicitly inherits (no fields set)', () => {
    expect(resolveWorktreeLocation(central, {})).toEqual({
      mode: 'central',
      root: '/Volumes/External/wt'
    })
  })

  it('lets the project override to beside even when the app is central', () => {
    expect(resolveWorktreeLocation(central, { worktreeLocation: 'beside' })).toEqual({
      mode: 'beside',
      root: null
    })
  })

  it('lets the project override to central with its own root', () => {
    expect(
      resolveWorktreeLocation(beside, {
        worktreeLocation: 'central',
        worktreeRoot: '/Volumes/Project/wt'
      })
    ).toEqual({ mode: 'central', root: '/Volumes/Project/wt' })
  })

  it('a project central override with no root of its own has no root', () => {
    expect(resolveWorktreeLocation(beside, { worktreeLocation: 'central' })).toEqual({
      mode: 'central',
      root: null
    })
  })
})

describe('worktreeBasePath', () => {
  it('is byte-identical to the parent of repoPath in beside mode', () => {
    expect(
      worktreeBasePath({
        location: { mode: 'beside', root: null },
        repoPath: '/Users/iso/code/arborist',
        repoName: 'arborist',
        branch: 'feature/x',
        platform: 'linux'
      })
    ).toBe('/Users/iso/code/feature-x')
  })

  it('nests under root/repoName in central mode', () => {
    expect(
      worktreeBasePath({
        location: { mode: 'central', root: '/Volumes/External/worktrees' },
        repoPath: '/Users/iso/code/arborist',
        repoName: 'arborist',
        branch: 'feature/x',
        platform: 'linux'
      })
    ).toBe('/Volumes/External/worktrees/arborist/feature-x')
  })

  it('sanitizes the branch name for the folder, on both platforms', () => {
    expect(
      worktreeBasePath({
        location: { mode: 'beside', root: null },
        repoPath: '/Users/iso/code/arborist',
        repoName: 'arborist',
        branch: 'feature/ABC-123',
        platform: 'linux'
      })
    ).toBe('/Users/iso/code/feature-ABC-123')
  })

  it('is testable for win32 from any host platform', () => {
    expect(
      worktreeBasePath({
        location: { mode: 'central', root: 'D:\\worktrees' },
        repoPath: 'C:\\code\\arborist',
        repoName: 'arborist',
        branch: 'feature/x',
        platform: 'win32'
      })
    ).toBe('D:\\worktrees\\arborist\\feature-x')
  })

  it('falls back to beside-like behaviour when central mode has no root set', () => {
    expect(
      worktreeBasePath({
        location: { mode: 'central', root: null },
        repoPath: '/Users/iso/code/arborist',
        repoName: 'arborist',
        branch: 'feature/x',
        platform: 'linux'
      })
    ).toBe('/Users/iso/code/feature-x')
  })
})

describe('rootConflictsWithProject', () => {
  it('flags the root when it is exactly a registered project path', () => {
    expect(
      rootConflictsWithProject('/Users/iso/code/arborist', ['/Users/iso/code/arborist'], 'darwin')
    ).toBe(true)
  })

  it('flags the root when it is nested inside a registered project', () => {
    expect(
      rootConflictsWithProject(
        '/Users/iso/code/arborist/worktrees',
        ['/Users/iso/code/arborist'],
        'darwin'
      )
    ).toBe(true)
  })

  it('does not flag a sibling directory that merely shares a name prefix', () => {
    expect(
      rootConflictsWithProject(
        '/Users/iso/code/arborist-other',
        ['/Users/iso/code/arborist'],
        'darwin'
      )
    ).toBe(false)
  })

  it('does not flag an unrelated directory', () => {
    expect(
      rootConflictsWithProject(
        '/Volumes/External/worktrees',
        ['/Users/iso/code/arborist'],
        'darwin'
      )
    ).toBe(false)
  })

  it('compares case-insensitively on win32', () => {
    expect(
      rootConflictsWithProject(
        'C:\\Users\\Iso\\Code\\Arborist',
        ['c:\\users\\iso\\code\\arborist'],
        'win32'
      )
    ).toBe(true)
  })
})
