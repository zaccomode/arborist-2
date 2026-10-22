import { describe, it, expect } from 'vitest'
import {
  applyAutomationEvent,
  automationCommands,
  describeRun,
  EMPTY_RUN,
  parseAutomationScript,
  setupToastKind,
  type AutomationEvent,
  type RunState
} from '@shared/automation'
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

/** Folds a sequence of events from nothing, the way the renderer's store does. */
function replay(...events: AutomationEvent[]): RunState {
  return events.reduce(applyAutomationEvent, EMPTY_RUN)
}

const runId = 'run-1'

describe('applyAutomationEvent', () => {
  it('lists the commands as pending when a run starts', () => {
    const state = replay({
      type: 'started',
      runId,
      commands: ['npm install', 'npm test'],
      startIndex: 0
    })

    expect(state.status).toBe('running')
    expect(state.commands.map((entry) => entry.status)).toEqual(['pending', 'pending'])
  })

  it('marks the commands before a retry point as skipped', () => {
    const state = replay({ type: 'started', runId, commands: ['a', 'b', 'c'], startIndex: 2 })

    expect(state.commands.map((entry) => entry.status)).toEqual(['skipped', 'skipped', 'pending'])
  })

  it('shows the substituted command once it starts, and collects its output', () => {
    const state = replay(
      { type: 'started', runId, commands: ['echo {{branch}}'], startIndex: 0 },
      { type: 'command-started', runId, index: 0, command: "echo 'main'" },
      { type: 'output', runId, index: 0, stream: 'stdout', chunk: 'ma' },
      { type: 'output', runId, index: 0, stream: 'stdout', chunk: 'in\n' }
    )

    expect(state.commands[0]).toEqual({
      command: "echo 'main'",
      status: 'running',
      output: 'main\n'
    })
  })

  it('records a non-zero exit as a failure, and where the run stopped', () => {
    const state = replay(
      { type: 'started', runId, commands: ['true', 'false'], startIndex: 0 },
      { type: 'command-started', runId, index: 0, command: 'true' },
      { type: 'command-finished', runId, index: 0, exitCode: 0 },
      { type: 'command-started', runId, index: 1, command: 'false' },
      { type: 'command-finished', runId, index: 1, exitCode: 1 },
      { type: 'finished', runId, status: 'failed', failedIndex: 1 }
    )

    expect(state.commands.map((entry) => entry.status)).toEqual(['succeeded', 'failed'])
    expect(state.status).toBe('failed')
    expect(state.failedIndex).toBe(1)
  })

  it('leaves the state it was given alone', () => {
    const before = replay({ type: 'started', runId, commands: ['a'], startIndex: 0 })
    applyAutomationEvent(before, { type: 'command-started', runId, index: 0, command: 'a' })

    expect(before.commands[0].status).toBe('pending')
  })
})

describe('describeRun', () => {
  const commands = (...statuses: RunState['commands'][number]['status'][]): RunState['commands'] =>
    statuses.map((status) => ({ command: 'x', status, output: '' }))

  it('says it is starting before it has heard of any commands', () => {
    expect(describeRun(EMPTY_RUN)).toBe('Starting…')
  })

  it('counts the command in progress', () => {
    const run: RunState = {
      commands: commands('succeeded', 'running', 'pending'),
      status: 'running',
      failedIndex: null
    }

    expect(describeRun(run)).toBe('Running 2 of 3')
  })

  it('names the command a failed run stopped at, counting from one', () => {
    const run: RunState = {
      commands: commands('succeeded', 'failed'),
      status: 'failed',
      failedIndex: 1
    }

    expect(describeRun(run)).toBe('Failed at command 2')
  })

  it('reports a completed and a cancelled run', () => {
    expect(
      describeRun({
        commands: commands('succeeded', 'succeeded'),
        status: 'completed',
        failedIndex: null
      })
    ).toBe('Completed 2 commands')
    expect(
      describeRun({ commands: commands('running'), status: 'cancelled', failedIndex: null })
    ).toBe('Cancelled')
  })
})

describe('setupToastKind', () => {
  it('shows no toast for a run whose console is on screen', () => {
    expect(setupToastKind('running', true)).toBe('none')
    expect(setupToastKind('failed', true)).toBe('none')
  })

  it('follows a run in the background, and says how it ended', () => {
    expect(setupToastKind('running', false)).toBe('running')
    expect(setupToastKind('completed', false)).toBe('completed')
    expect(setupToastKind('failed', false)).toBe('failed')
  })

  it('says nothing about a cancelled run, since cancelling happens in plain sight', () => {
    expect(setupToastKind('cancelled', false)).toBe('none')
  })
})
