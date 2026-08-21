import { describe, it, expect } from 'vitest'
import { automationCommands, parseAutomationScript } from '@shared/automation'
import { shellInvocation } from '../../src/main/services/automation'
import { settingsSchema, type Settings } from '@shared/persisted'

const defaults: Settings = settingsSchema.parse({})

describe('parseAutomationScript', () => {
  it('treats each non-blank, non-comment line as its own command', () => {
    const lines = parseAutomationScript('npm install\nnpm run build')

    expect(lines.map((line) => line.command)).toEqual(['npm install', 'npm run build'])
    expect(lines.map((line) => line.lineNumber)).toEqual([1, 2])
  })

  it('skips blank lines and comments, keeping their place in the file', () => {
    const lines = parseAutomationScript('# setup\n\nnpm install\n   \n# done')

    expect(lines.map((line) => line.command)).toEqual([null, null, 'npm install', null, null])
    expect(lines[2].lineNumber).toBe(3)
  })

  it('trims surrounding whitespace from a command', () => {
    expect(automationCommands('  npm install  ')).toEqual(['npm install'])
  })

  it('finds nothing in an empty script', () => {
    expect(automationCommands('')).toEqual([])
    expect(automationCommands('\n\n# nothing here\n')).toEqual([])
  })
})

describe('shellInvocation', () => {
  it('uses a login shell on macOS, so PATH tools resolve', () => {
    expect(shellInvocation('npm install', defaults, 'darwin')).toEqual({
      file: '/bin/bash',
      args: ['-l', '-c', 'npm install']
    })
  })

  it('uses PowerShell on Windows by default', () => {
    expect(shellInvocation('npm install', defaults, 'win32')).toEqual({
      file: 'powershell',
      args: ['-NoProfile', '-Command', 'npm install']
    })
  })

  it('uses cmd on Windows when the setting says so', () => {
    const settings = { ...defaults, automationShell: 'cmd' as const }

    expect(shellInvocation('npm install', settings, 'win32')).toEqual({
      file: 'cmd',
      args: ['/c', 'npm install']
    })
  })

  it('lets a custom shell override the platform default', () => {
    const settings = {
      ...defaults,
      customShellPath: '/opt/homebrew/bin/zsh',
      customShellArgs: ['-lc']
    }

    expect(shellInvocation('npm install', settings, 'darwin')).toEqual({
      file: '/opt/homebrew/bin/zsh',
      args: ['-lc', 'npm install']
    })
  })
})
