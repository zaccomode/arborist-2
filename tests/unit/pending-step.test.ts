import { describe, expect, it } from 'vitest'
import { createPendingStep } from '@shared/pending-step'

describe('createPendingStep', () => {
  it('stays live until cancelled', () => {
    const step = createPendingStep()
    const live = step.begin()
    expect(live()).toBe(true)
    step.cancel()
    expect(live()).toBe(false)
  })

  it('is superseded by a later step', () => {
    const step = createPendingStep()
    const first = step.begin()
    const second = step.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('leaves a step begun after a cancel alone', () => {
    const step = createPendingStep()
    step.cancel()
    expect(step.begin()()).toBe(true)
  })
})
