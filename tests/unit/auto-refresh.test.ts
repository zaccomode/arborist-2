import { describe, expect, it } from 'vitest'
import { AUTO_FETCH_MIN_GAP_MS, shouldAutoFetch } from '../../src/shared/auto-refresh'

describe('shouldAutoFetch', () => {
  it('fetches a repository that has never been fetched', () => {
    expect(shouldAutoFetch(undefined, 1000)).toBe(true)
  })
  it('holds off inside the minimum gap', () => {
    expect(shouldAutoFetch(1000, 1000 + AUTO_FETCH_MIN_GAP_MS - 1)).toBe(false)
  })
  it('fetches again once the gap has passed', () => {
    expect(shouldAutoFetch(1000, 1000 + AUTO_FETCH_MIN_GAP_MS)).toBe(true)
  })
  it('recovers from a clock that went backwards', () => {
    expect(shouldAutoFetch(5000, 1000)).toBe(true)
  })
})
