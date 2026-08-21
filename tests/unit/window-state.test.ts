import { describe, it, expect } from 'vitest'
import {
  clampToDisplays,
  type DisplayArea,
  type WindowState
} from '../../src/main/services/persistence/window-state'

const LAPTOP: DisplayArea = { x: 0, y: 0, width: 1440, height: 900 }
/** A monitor to the right of the laptop, as a docked desk usually has it. */
const EXTERNAL: DisplayArea = { x: 1440, y: 0, width: 2560, height: 1440 }

function state(overrides: Partial<WindowState> = {}): WindowState {
  return { width: 1100, height: 720, x: 100, y: 80, maximized: false, ...overrides }
}

describe('clampToDisplays', () => {
  it('leaves a window that is already on a display exactly where it is', () => {
    const remembered = state()
    expect(clampToDisplays(remembered, [LAPTOP, EXTERNAL])).toEqual(remembered)
  })

  it('re-centres a window remembered on a monitor that is no longer attached', () => {
    const remembered = state({ x: 2000, y: 300 })

    const result = clampToDisplays(remembered, [LAPTOP])

    expect(result).toEqual({ width: 1100, height: 720, x: 170, y: 90, maximized: false })
  })

  it('leaves a window straddling two monitors alone', () => {
    // Deliberate layouts are the user's business; only a lost window is ours.
    const remembered = state({ x: 1200, y: 100 })
    expect(clampToDisplays(remembered, [LAPTOP, EXTERNAL])).toEqual(remembered)
  })

  it('rescues a window with only a sliver on screen', () => {
    const remembered = state({ x: 1400, y: 100 })
    expect(clampToDisplays(remembered, [LAPTOP]).x).toBe(170)
  })

  it('rescues a window dragged off the top of the screen', () => {
    const remembered = state({ x: 100, y: -700 })
    expect(clampToDisplays(remembered, [LAPTOP]).y).toBe(90)
  })

  it('shrinks a window remembered larger than the display it lands on', () => {
    const remembered = state({ width: 3000, height: 1800, x: 1500, y: 0 })

    const result = clampToDisplays(remembered, [LAPTOP])

    expect(result).toMatchObject({ width: 1440, height: 900, x: 0, y: 0 })
  })

  it('centres a window that has never been positioned', () => {
    const result = clampToDisplays({ width: 1100, height: 720, maximized: false }, [
      LAPTOP,
      EXTERNAL
    ])

    expect(result).toMatchObject({ x: 170, y: 90 })
  })

  it('respects a work area that starts below a menu bar', () => {
    const withMenuBar: DisplayArea = { x: 0, y: 25, width: 1440, height: 875 }

    const result = clampToDisplays(state({ x: 9000, y: 9000 }), [withMenuBar])

    expect(result.y).toBe(103)
  })

  it('returns the state untouched when no display is reported', () => {
    const remembered = state({ x: 9000 })
    expect(clampToDisplays(remembered, [])).toEqual(remembered)
  })

  it('carries the maximised flag through a rescue', () => {
    const result = clampToDisplays(state({ x: 9000, maximized: true }), [LAPTOP])
    expect(result.maximized).toBe(true)
  })
})
