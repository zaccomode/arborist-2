import { describe, it, expect } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc-contract'

/**
 * The preload whitelists these two lists and nothing else, so a channel the
 * contract declares and the list omits throws "IPC channel not in contract"
 * the first time a user presses the button that needs it — as
 * `system:pickApplication` did.
 *
 * Both lists are built from an exhaustive `Record<Channel, true>` now, which
 * makes the omission a type error. These tests guard what the type cannot:
 * that the derived arrays are non-empty and free of duplicates, so a bad
 * refactor of that derivation fails here rather than in the app.
 */
describe('the IPC channel whitelists', () => {
  it.each([
    ['invoke', IPC_CHANNELS],
    ['event', IPC_EVENT_CHANNELS]
  ])('lists every %s channel exactly once', (_kind, channels) => {
    expect(channels.length).toBeGreaterThan(0)
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('carries the channels the renderer actually reaches for', () => {
    // A spot check on the derivation itself: Object.keys over a Record loses
    // nothing, but it would be a quiet loss if it did.
    for (const channel of ['system:pickFolder', 'system:pickApplication', 'presets:run'] as const) {
      expect(IPC_CHANNELS).toContain(channel)
    }
  })
})
