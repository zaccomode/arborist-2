import { describe, it, expect } from 'vitest'
import {
  abortArgsFor,
  canKeepOurs,
  conflictBannerText,
  conflictCodeLabel,
  conflictVerb,
  continueArgsFor,
  parseMergeSourceFromMsg,
  shortRefName,
  type ConflictState
} from '@shared/conflicts'
import type { UnmergedCode } from '@shared/domain'

describe('conflictCodeLabel', () => {
  it.each<[UnmergedCode, string]>([
    ['UU', 'both modified'],
    ['AA', 'both added'],
    ['DD', 'both deleted'],
    ['AU', 'added by us'],
    ['UA', 'added by them'],
    ['DU', 'deleted by us'],
    ['UD', 'deleted by them']
  ])('reads %s as %s', (code, label) => {
    expect(conflictCodeLabel(code)).toBe(label)
  })
})

describe('canKeepOurs', () => {
  it('is offered only on UU', () => {
    expect(canKeepOurs('UU')).toBe(true)
  })

  it('is a footgun everywhere else, so it is withheld', () => {
    expect(canKeepOurs('AA')).toBe(false)
    expect(canKeepOurs('DU')).toBe(false)
    expect(canKeepOurs('UD')).toBe(false)
    expect(canKeepOurs('AU')).toBe(false)
    expect(canKeepOurs('UA')).toBe(false)
    expect(canKeepOurs('DD')).toBe(false)
    expect(canKeepOurs(null)).toBe(false)
  })
})

describe('conflictVerb', () => {
  it.each<[ConflictState['operation'], string]>([
    ['merge', 'Merging'],
    ['rebase', 'Rebasing'],
    ['cherry-pick', 'Cherry-picking'],
    ['revert', 'Reverting']
  ])('names %s as %s', (operation, verb) => {
    expect(conflictVerb(operation!)).toBe(verb)
  })
})

describe('conflictBannerText', () => {
  it('names both sides of a merge', () => {
    const state: ConflictState = {
      operation: 'merge',
      sourceLabel: 'main',
      targetLabel: 'feature-x'
    }
    expect(conflictBannerText(state, 2)).toBe('Merging main into feature-x — 2 files conflict.')
  })

  it('names both sides of a rebase, target onto source', () => {
    const state: ConflictState = {
      operation: 'rebase',
      sourceLabel: 'main',
      targetLabel: 'feature-x'
    }
    expect(conflictBannerText(state, 1)).toBe('Rebasing feature-x onto main — 1 file conflict.')
  })

  it('names just the source for a cherry-pick', () => {
    const state: ConflictState = {
      operation: 'cherry-pick',
      sourceLabel: 'abc1234',
      targetLabel: 'main'
    }
    expect(conflictBannerText(state, 1)).toBe('Cherry-picking abc1234 — 1 file conflict.')
  })

  it('names just the source for a revert', () => {
    const state: ConflictState = {
      operation: 'revert',
      sourceLabel: 'abc1234',
      targetLabel: 'main'
    }
    expect(conflictBannerText(state, 1)).toBe('Reverting abc1234 — 1 file conflict.')
  })

  it('degrades to just the verb when a label is missing', () => {
    const state: ConflictState = { operation: 'merge', sourceLabel: null, targetLabel: 'feature-x' }
    expect(conflictBannerText(state, 3)).toBe('Merging — 3 files conflict.')
  })

  it('is just the file count with no operation detected', () => {
    const state: ConflictState = { operation: null, sourceLabel: null, targetLabel: null }
    expect(conflictBannerText(state, 2)).toBe('2 files conflict.')
  })
})

describe('abortArgsFor / continueArgsFor', () => {
  it('matches the operation to its own git subcommand', () => {
    expect(abortArgsFor('merge')).toEqual(['merge', '--abort'])
    expect(abortArgsFor('rebase')).toEqual(['rebase', '--abort'])
    expect(abortArgsFor('cherry-pick')).toEqual(['cherry-pick', '--abort'])
    expect(abortArgsFor('revert')).toEqual(['revert', '--abort'])
  })

  it('neutralises the editor on continue, so it cannot hang the child', () => {
    expect(continueArgsFor('merge')).toEqual(['-c', 'core.editor=true', 'merge', '--continue'])
    expect(continueArgsFor('rebase')).toEqual(['-c', 'core.editor=true', 'rebase', '--continue'])
  })
})

describe('shortRefName', () => {
  it('strips refs/heads/', () => {
    expect(shortRefName('refs/heads/feature-x')).toBe('feature-x')
  })

  it('leaves anything else alone', () => {
    expect(shortRefName('refs/remotes/origin/main')).toBe('refs/remotes/origin/main')
  })
})

describe('parseMergeSourceFromMsg', () => {
  it('reads a plain branch merge', () => {
    expect(parseMergeSourceFromMsg("Merge branch 'main' into feature-x\n")).toBe('main')
  })

  it('reads a remote-tracking merge', () => {
    expect(
      parseMergeSourceFromMsg("Merge remote-tracking branch 'origin/main' into feature-x\n")
    ).toBe('origin/main')
  })

  it('reads a tag merge', () => {
    expect(parseMergeSourceFromMsg("Merge tag 'v1.2.3' into feature-x\n")).toBe('v1.2.3')
  })

  it('reads a bare commit merge', () => {
    expect(parseMergeSourceFromMsg("Merge commit 'abc1234' into feature-x\n")).toBe('abc1234')
  })

  it('returns null for a message in a shape it does not recognise', () => {
    expect(parseMergeSourceFromMsg('A hand-written merge message\n')).toBeNull()
  })
})
