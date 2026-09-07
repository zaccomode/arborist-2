import { describe, it, expect } from 'vitest'
import { pickExecutable } from '../../src/shared/which'
import { which } from '../../src/main/services/system/which'

describe('pickExecutable', () => {
  it('takes the first non-blank line on a non-Windows platform', () => {
    expect(pickExecutable(['/usr/local/bin/code', ''], 'darwin')).toBe('/usr/local/bin/code')
    expect(pickExecutable(['', '/usr/bin/code', '/usr/local/bin/code'], 'linux')).toBe(
      '/usr/bin/code'
    )
  })

  it('returns null when every candidate is blank', () => {
    expect(pickExecutable([], 'darwin')).toBeNull()
    expect(pickExecutable(['', '  '], 'win32')).toBeNull()
  })

  it('prefers a .cmd entry over an extension-less shim on Windows (#63)', () => {
    const candidates = [
      'C:\\Users\\Big Nuts\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code',
      'C:\\Users\\Big Nuts\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd'
    ]

    expect(pickExecutable(candidates, 'win32')).toBe(
      'C:\\Users\\Big Nuts\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd'
    )
  })

  it('prefers a .cmd entry regardless of which order where lists them in', () => {
    const candidates = ['C:\\tools\\code.cmd', 'C:\\Program Files\\Microsoft VS Code\\bin\\code']

    expect(pickExecutable(candidates, 'win32')).toBe('C:\\tools\\code.cmd')
  })

  it('recognises .exe and .bat too, case-insensitively', () => {
    expect(pickExecutable(['C:\\tools\\code', 'C:\\tools\\code.EXE'], 'win32')).toBe(
      'C:\\tools\\code.EXE'
    )
    expect(pickExecutable(['C:\\tools\\code', 'C:\\tools\\code.bat'], 'win32')).toBe(
      'C:\\tools\\code.bat'
    )
  })

  it('falls back to the first line when nothing has a known extension', () => {
    const candidates = ['C:\\tools\\code', 'C:\\tools\\code.ps1']

    expect(pickExecutable(candidates, 'win32')).toBe('C:\\tools\\code')
  })

  it('ignores blank lines mixed in with real candidates on Windows', () => {
    expect(pickExecutable(['', 'C:\\tools\\code', '', 'C:\\tools\\code.cmd'], 'win32')).toBe(
      'C:\\tools\\code.cmd'
    )
  })
})

describe('which', () => {
  it('resolves the absolute path of something that is on PATH', async () => {
    // `node` is running this suite, so it is on PATH by definition.
    await expect(which('node')).resolves.toContain('node')
  })

  /**
   * #83 split "not on PATH" from "this machine could not start the lookup",
   * which used to be the same null. The half that has to keep working is
   * this one: a genuinely absent command is still an answer, not an error.
   */
  it('resolves null for a command that is not there, rather than rejecting', async () => {
    await expect(which('definitely-not-a-real-command-xyz')).resolves.toBeNull()
  })
})
