import { describe, it, expect } from 'vitest'
import { AppError, serializeError, deserializeError } from '@shared/errors'

describe('error serialization', () => {
  it('round-trips an AppError with its code', () => {
    const original = new AppError('branch already exists', 'branch-already-exists')
    const rehydrated = deserializeError(serializeError(original))

    expect(rehydrated).toBeInstanceOf(AppError)
    expect(rehydrated.message).toBe('branch already exists')
    expect(rehydrated.code).toBe('branch-already-exists')
  })

  it('serializes plain Errors with an unknown code', () => {
    const serialized = serializeError(new TypeError('boom'))
    expect(serialized).toEqual({ name: 'TypeError', message: 'boom', code: 'unknown' })
  })

  it('serializes non-Error throws', () => {
    const serialized = serializeError('just a string')
    expect(serialized.message).toBe('just a string')
    expect(serialized.code).toBe('unknown')
  })
})
