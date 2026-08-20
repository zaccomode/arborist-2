import { describe, it, expect } from 'vitest'
import { parseBranchInput, sanitizeForFolder, validateBranchName } from '@shared/branch-name'

describe('parseBranchInput', () => {
  it('passes a bare branch name through', () => {
    expect(parseBranchInput('feature/ABC-123')).toBe('feature/ABC-123')
  })

  it.each([
    ['git checkout -b feature/x', 'feature/x'],
    ['git checkout feature/x', 'feature/x'],
    ['git switch -c feature/x', 'feature/x'],
    ['git switch --create feature/x', 'feature/x'],
    ['git switch feature/x', 'feature/x'],
    ['git branch feature/x', 'feature/x'],
    ['git co -b feature/x', 'feature/x'],
    ['git co feature/x', 'feature/x']
  ])('strips the command in %s', (input, expected) => {
    expect(parseBranchInput(input)).toBe(expected)
  })

  it('strips a command whatever its case', () => {
    expect(parseBranchInput('GIT CHECKOUT -B feature/x')).toBe('feature/x')
  })

  it('strips a remote prefix', () => {
    expect(parseBranchInput('origin/feature/x')).toBe('feature/x')
    expect(parseBranchInput('git checkout origin/feature/x')).toBe('feature/x')
  })

  it('keeps only the first token, dropping the rest of a pasted command', () => {
    expect(parseBranchInput('git checkout -b feature/x origin/main')).toBe('feature/x')
  })

  it('trims surrounding whitespace', () => {
    expect(parseBranchInput('   feature/x  \n')).toBe('feature/x')
  })

  it('returns an empty string for empty input', () => {
    expect(parseBranchInput('   ')).toBe('')
  })
})

describe('validateBranchName', () => {
  it.each(['main', 'feature/ABC-123', 'release/1.0', 'user/iso/fix-thing', 'v2.1'])(
    'accepts %s',
    (name) => {
      expect(validateBranchName(name).valid).toBe(true)
    }
  )

  it.each([
    ['', 'empty'],
    ['feature..x', 'double dot'],
    ['feature//x', 'double slash'],
    ['feature@{1}', 'at-brace'],
    ['feature\\x', 'backslash'],
    ['/feature', 'leading slash'],
    ['feature/', 'trailing slash'],
    ['.feature', 'leading dot'],
    ['feature.', 'trailing dot'],
    ['feature.lock', 'trailing .lock'],
    ['feature x', 'space'],
    ['feature~1', 'tilde'],
    ['feature^', 'caret'],
    ['feature:x', 'colon'],
    ['feature?', 'question mark'],
    ['feature*', 'asterisk'],
    ['feature[1]', 'open bracket'],
    ['feature\u0007x', 'control character']
  ])('rejects %j (%s)', (name) => {
    const result = validateBranchName(name)
    expect(result.valid).toBe(false)
    expect(result.reason).toBeTruthy()
  })
})

describe('sanitizeForFolder', () => {
  it('turns slashes into dashes', () => {
    expect(sanitizeForFolder('feature/ABC-123')).toBe('feature-ABC-123')
  })

  it('flattens nested slashes without leaving repeated dashes', () => {
    expect(sanitizeForFolder('user/iso/fix/thing')).toBe('user-iso-fix-thing')
    expect(sanitizeForFolder('a//b')).toBe('a-b')
  })

  it('strips characters Windows rejects, on every platform', () => {
    expect(sanitizeForFolder('fix:the*thing?')).toBe('fixthething')
    expect(sanitizeForFolder('issue#42')).toBe('issue42')
  })

  it('trims leading and trailing dashes and dots', () => {
    expect(sanitizeForFolder('/feature/x/')).toBe('feature-x')
    expect(sanitizeForFolder('...feature...')).toBe('feature')
  })

  it('keeps unicode, which is valid in a path', () => {
    expect(sanitizeForFolder('feature/café')).toBe('feature-café')
  })

  it.each(['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9'])(
    'suffixes the Windows device name %s',
    (name) => {
      expect(sanitizeForFolder(name)).toBe(`${name}-wt`)
    }
  )

  it('leaves a name merely starting with a device name alone', () => {
    expect(sanitizeForFolder('console')).toBe('console')
  })

  it('falls back to a usable name when nothing survives', () => {
    expect(sanitizeForFolder('///')).toBe('worktree')
    expect(sanitizeForFolder('***')).toBe('worktree')
  })
})
