import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AutomationEvent } from '../../src/shared/automation'
import { settingsSchema } from '../../src/shared/persisted'
import { AutomationRunner } from '../../src/main/services/automation'

const settings = settingsSchema.parse({})

let cwd: string
let events: AutomationEvent[]
let runner: AutomationRunner

const values = {
  path: '/tmp/worktree',
  branch: 'feature/x',
  commitHash: 'abc1234',
  repoName: 'arborist',
  repoPath: '/tmp/arborist'
}

/** Resolves once the run reports it has finished, however it finished. */
function finished(): Promise<AutomationEvent & { type: 'finished' }> {
  return new Promise((resolve) => {
    const check = (): void => {
      const event = events.find((entry) => entry.type === 'finished')
      if (event) resolve(event as AutomationEvent & { type: 'finished' })
      else setTimeout(check, 20)
    }
    check()
  })
}

beforeEach(async () => {
  // realpath because the temp directory a shell reports back is the resolved
  // one: /private/var rather than /var on macOS, and the long form rather
  // than the 8.3 short form on Windows.
  cwd = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'arborist-automation-')))
  events = []
  runner = new AutomationRunner(
    (event) => events.push(event),
    () => settings
  )
})

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true })
})

describe('the automation runner', () => {
  it('runs each line in order and streams what it prints', async () => {
    runner.start({
      script: 'echo one\n# a comment\necho two\n\necho three',
      worktreePath: cwd,
      values
    })
    const end = await finished()

    expect(end.status).toBe('completed')
    const started = events.find((event) => event.type === 'started')
    expect(started).toMatchObject({ commands: ['echo one', 'echo two', 'echo three'] })

    const output = events
      .filter((event) => event.type === 'output')
      .map((event) => event.chunk)
      .join('')
    expect(output).toContain('one')
    expect(output).toContain('two')
    expect(output).toContain('three')
  }, 30_000)

  it('runs with the worktree as the working directory', async () => {
    runner.start({ script: 'pwd', worktreePath: cwd, values })
    await finished()

    const output = events
      .filter((event) => event.type === 'output')
      .map((event) => event.chunk)
      .join('')
    expect(output.trim()).toContain(cwd)
  }, 30_000)

  it('stops at the first failure and says which command it was', async () => {
    runner.start({ script: 'echo one\nexit 3\necho three', worktreePath: cwd, values })
    const end = await finished()

    expect(end).toMatchObject({ status: 'failed', failedIndex: 1 })
    expect(events.filter((event) => event.type === 'command-started')).toHaveLength(2)
  }, 30_000)

  it('resumes from the command that failed', async () => {
    runner.start({
      script: 'echo one\necho two\necho three',
      worktreePath: cwd,
      values,
      startIndex: 1
    })
    const end = await finished()

    expect(end.status).toBe('completed')
    expect(
      events.filter((event) => event.type === 'command-started').map((event) => event.index)
    ).toEqual([1, 2])
  }, 30_000)

  it('substitutes tokens, quoting values so a path with spaces survives', async () => {
    runner.start({
      script: 'echo {{branch}} in {{repoName}}',
      worktreePath: cwd,
      values: { ...values, branch: "feature/it's here" }
    })
    await finished()

    const output = events
      .filter((event) => event.type === 'output')
      .map((event) => event.chunk)
      .join('')
    // Each value separately, because PowerShell's echo puts every argument on
    // its own line: what matters is that a value carrying a quote and spaces
    // arrived intact rather than splitting the command.
    expect(output).toContain("feature/it's here")
    expect(output).toContain('arborist')
  }, 30_000)

  it('cancels a long-running command, and quickly', async () => {
    const runId = runner.start({ script: 'sleep 60', worktreePath: cwd, values })

    // Give the shell a moment to actually start sleeping.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const startedAt = Date.now()
    runner.cancel(runId)
    const end = await finished()

    expect(end.status).toBe('cancelled')
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  }, 30_000)
})
