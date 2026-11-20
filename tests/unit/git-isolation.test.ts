import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import config from '../../vitest.config'
import { isolatedGitEnv } from '../integration/fixtures/git-fixture'

describe('git config isolation (#168)', () => {
  it("runs the suite's git with the same isolation the fixtures use", () => {
    expect(config.test?.env).toEqual(isolatedGitEnv)
    for (const [key, value] of Object.entries(isolatedGitEnv)) {
      expect(process.env[key]).toBe(value)
    }
  })

  it('leaves git with no config beyond a repository of its own', async () => {
    const output = await new Promise<string>((resolve, reject) =>
      execFile('git', ['config', '--list'], { cwd: tmpdir(), env: process.env }, (error, stdout) =>
        error && error.code !== 1 ? reject(error) : resolve(stdout)
      )
    )
    expect(output.trim()).toBe('')
  })
})
