import { describe, it, expect } from 'vitest'
import { win32, posix } from 'path'
import {
  joinPath,
  normaliseForCompare,
  normaliseGitPath,
  parentPath,
  samePath
} from '../../src/shared/paths'

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

describe('joinPath', () => {
  it('joins with a forward slash on posix, matching path.posix.join', () => {
    expect(joinPath('linux', '/Users/iso/code', 'feature-x')).toBe(
      posix.join('/Users/iso/code', 'feature-x')
    )
  })

  it('joins with a backslash on win32, matching path.win32.join', () => {
    expect(joinPath('win32', 'C:\\Users\\Iso\\code', 'feature-x')).toBe(
      win32.join('C:\\Users\\Iso\\code', 'feature-x')
    )
  })

  it('is testable for win32 from any host platform', () => {
    expect(joinPath('win32', 'D:\\worktrees', 'arborist', 'feature-x')).toBe(
      'D:\\worktrees\\arborist\\feature-x'
    )
  })

  it('does not duplicate separators at a join point', () => {
    expect(joinPath('linux', '/Users/iso/code/', '/feature-x')).toBe('/Users/iso/code/feature-x')
  })

  it('drops empty segments', () => {
    expect(joinPath('linux', '/root', '', 'leaf')).toBe('/root/leaf')
  })
})

describe('parentPath', () => {
  it('matches path.posix.dirname for an ordinary path', () => {
    expect(parentPath('linux', '/Users/iso/code/arborist')).toBe(
      posix.dirname('/Users/iso/code/arborist')
    )
  })

  it('matches path.win32.dirname for an ordinary path', () => {
    expect(parentPath('win32', 'C:\\Users\\Iso\\code\\arborist')).toBe(
      win32.dirname('C:\\Users\\Iso\\code\\arborist')
    )
  })

  it('keeps the trailing backslash on a win32 drive root', () => {
    expect(parentPath('win32', 'C:\\repo')).toBe(win32.dirname('C:\\repo'))
    expect(parentPath('win32', 'C:\\repo')).toBe('C:\\')
  })

  it('is testable for win32 from any host platform', () => {
    expect(parentPath('win32', 'D:\\worktrees\\arborist')).toBe('D:\\worktrees')
  })

  it('returns "." for a bare relative name, matching path.dirname', () => {
    expect(parentPath('linux', 'arborist')).toBe(posix.dirname('arborist'))
  })
})
