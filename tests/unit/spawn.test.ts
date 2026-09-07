import { describe, it, expect, vi } from 'vitest'
import { AppError } from '../../src/shared/errors'
import { isTransientSpawnCode, retryTransientSpawn } from '../../src/main/services/system/spawn'

describe('isTransientSpawnCode', () => {
  /**
   * The retry is deliberately narrow. `ENOENT` and `EACCES` are facts about
   * the binary that will not change on a second attempt, so retrying them
   * would double the wait before telling the user their editor is missing.
   */
  it('covers the resource-exhaustion errnos and nothing else', () => {
    for (const code of ['EBADF', 'EMFILE', 'ENFILE', 'EAGAIN']) {
      expect(isTransientSpawnCode(code)).toBe(true)
    }
    for (const code of ['ENOENT', 'EACCES', 'ENOTDIR', 'ABORT_ERR']) {
      expect(isTransientSpawnCode(code)).toBe(false)
    }
  })

  it('ignores a numeric exit code, which is an exit rather than a spawn failure', () => {
    expect(isTransientSpawnCode(128)).toBe(false)
    expect(isTransientSpawnCode(undefined)).toBe(false)
  })
})

describe('retryTransientSpawn', () => {
  it('runs the attempt once when it succeeds', async () => {
    const attempt = vi.fn().mockResolvedValue('ok')

    await expect(retryTransientSpawn('spawn-failed', attempt)).resolves.toBe('ok')
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('runs a second attempt after a transient failure, and resolves if it works', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new AppError('out of descriptors', 'spawn-failed'))
      .mockResolvedValueOnce('ok')

    await expect(retryTransientSpawn('spawn-failed', attempt)).resolves.toBe('ok')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('propagates the second failure rather than looping', async () => {
    const attempt = vi.fn().mockRejectedValue(new AppError('still out', 'spawn-failed'))

    await expect(retryTransientSpawn('spawn-failed', attempt)).rejects.toMatchObject({
      code: 'spawn-failed'
    })
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  /** A missing binary is an answer, not a hiccup: retrying only slows it down. */
  it('does not retry a failure of any other kind', async () => {
    const attempt = vi.fn().mockRejectedValue(new AppError('no such thing', 'preset-launch-failed'))

    await expect(retryTransientSpawn('spawn-failed', attempt)).rejects.toMatchObject({
      code: 'preset-launch-failed'
    })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('does not retry a plain Error, which carries no code to match on', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(retryTransientSpawn('spawn-failed', attempt)).rejects.toThrow('boom')
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})
