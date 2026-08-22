import { describe, it, expect } from 'vitest'
import { normaliseForCompare, normaliseGitPath, samePath } from '../../src/shared/paths'

describe('normaliseGitPath', () => {
  it('turns the forward slashes git prints into backslashes on win32', () => {
    expect(normaliseGitPath('C:/Users/iso/code/arborist', 'win32')).toBe(
      'C:\\Users\\iso\\code\\arborist'
    )
  })

  it('leaves a posix path alone', () => {
    expect(normaliseGitPath('/Users/iso/code/arborist', 'darwin')).toBe('/Users/iso/code/arborist')
  })
})

describe('normaliseForCompare', () => {
  it('folds case on win32, where the filesystem does', () => {
    expect(normaliseForCompare('C:\\Users\\Iso\\Code', 'win32')).toBe('c:\\users\\iso\\code')
  })

  it('does not fold case on darwin, where two names can differ', () => {
    expect(normaliseForCompare('/Users/Iso/Code', 'darwin')).toBe('/Users/Iso/Code')
  })

  it('drops a trailing separator', () => {
    expect(normaliseForCompare('/Users/iso/code/', 'darwin')).toBe('/Users/iso/code')
    expect(normaliseForCompare('C:\\code\\', 'win32')).toBe('c:\\code')
  })

  it('keeps a root path that is nothing but a separator', () => {
    expect(normaliseForCompare('/', 'darwin')).toBe('/')
  })
})

describe('samePath', () => {
  it('matches the same Windows folder reached through different casing', () => {
    expect(
      samePath('C:\\Users\\Iso\\code\\arborist', 'c:\\users\\iso\\code\\arborist', 'win32')
    ).toBe(true)
  })

  it('matches a git-printed path against one the app built', () => {
    expect(samePath('C:/Users/iso/code/arborist', 'C:\\Users\\iso\\code\\arborist', 'win32')).toBe(
      true
    )
  })

  it('keeps case-differing paths apart on darwin', () => {
    expect(samePath('/Users/iso/Code', '/Users/iso/code', 'darwin')).toBe(false)
  })

  it('does not treat two absent paths as equal', () => {
    // Nothing selected must not match a worktree; both ends being null is the
    // shape the sidebar passes on first render.
    expect(samePath(null, null, 'darwin')).toBe(false)
    expect(samePath(undefined, '/a', 'darwin')).toBe(false)
  })

  it('keeps sibling paths apart', () => {
    expect(samePath('/Users/iso/code/a', '/Users/iso/code/ab', 'darwin')).toBe(false)
  })
})
