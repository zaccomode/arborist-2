import { describe, expect, it } from 'vitest'
import { createFocusReturn, createMenuCloseGuard } from '@shared/menu-dialog-focus'

function event(): { preventDefault: () => void; prevented: boolean } {
  const result = {
    prevented: false,
    preventDefault() {
      result.prevented = true
    }
  }
  return result
}

function element(isConnected = true): { focus: () => void; focused: number; isConnected: boolean } {
  const result = {
    focused: 0,
    isConnected,
    focus() {
      result.focused += 1
    }
  }
  return result
}

describe('createMenuCloseGuard (#146, #147)', () => {
  it("leaves the menu's focus return alone when no item opened a dialog", () => {
    const guard = createMenuCloseGuard()
    const close = event()
    guard.onCloseAutoFocus(close)
    expect(close.prevented).toBe(false)
  })

  it("suppresses the menu's focus return once after an item opened a dialog", () => {
    const guard = createMenuCloseGuard()
    guard.markOpening()
    const first = event()
    guard.onCloseAutoFocus(first)
    expect(first.prevented).toBe(true)

    // The next close, say after Escape on the menu alone, returns focus as usual.
    const second = event()
    guard.onCloseAutoFocus(second)
    expect(second.prevented).toBe(false)
  })

  it('keeps each menu separate', () => {
    const stash = createMenuCloseGuard()
    const actions = createMenuCloseGuard()
    stash.markOpening()
    const close = event()
    actions.onCloseAutoFocus(close)
    expect(close.prevented).toBe(false)
  })
})

describe('createFocusReturn (#147)', () => {
  it('puts focus back on the remembered trigger when the dialog closes', () => {
    const focusReturn = createFocusReturn()
    const trigger = element()
    focusReturn.remember(trigger)
    const close = event()
    focusReturn.restore(close, true)
    expect(close.prevented).toBe(true)
    expect(trigger.focused).toBe(1)
  })

  it("leaves Radix's own focus return when nothing was remembered", () => {
    const focusReturn = createFocusReturn()
    const close = event()
    focusReturn.restore(close, true)
    expect(close.prevented).toBe(false)
  })

  it('forgets the trigger after one close', () => {
    const focusReturn = createFocusReturn()
    const trigger = element()
    focusReturn.remember(trigger)
    focusReturn.restore(event(), true)

    // A dialog opened some other way later keeps its default.
    const later = event()
    focusReturn.restore(later, true)
    expect(later.prevented).toBe(false)
    expect(trigger.focused).toBe(1)
  })

  it('does not take focus from something that already has it, such as the commit box', () => {
    const focusReturn = createFocusReturn()
    const trigger = element()
    focusReturn.remember(trigger)
    const close = event()
    focusReturn.restore(close, false)
    expect(close.prevented).toBe(false)
    expect(trigger.focused).toBe(0)

    // Forgotten all the same, so it can't fire on a later, unrelated dialog.
    focusReturn.restore(event(), true)
    expect(trigger.focused).toBe(0)
  })

  it('skips a trigger that has left the document, such as a deleted worktree', () => {
    const focusReturn = createFocusReturn()
    const trigger = element(false)
    focusReturn.remember(trigger)
    const close = event()
    focusReturn.restore(close, true)
    expect(close.prevented).toBe(false)
    expect(trigger.focused).toBe(0)
  })

  describe('handing off to a second dialog (#156)', () => {
    it('keeps the trigger through the first close and returns to it after the second', () => {
      const focusReturn = createFocusReturn()
      const trigger = element()
      focusReturn.remember(trigger)
      focusReturn.handOff()

      // The first dialog closes with focus already in the second.
      const first = event()
      focusReturn.restore(first, false)
      expect(first.prevented).toBe(true)
      expect(trigger.focused).toBe(0)

      // The second closes, Cancel or Escape, and focus goes back to the menu.
      const second = event()
      focusReturn.restore(second, true)
      expect(second.prevented).toBe(true)
      expect(trigger.focused).toBe(1)
    })

    it('holds focus in the second dialog even if the first closes before it opens', () => {
      const focusReturn = createFocusReturn()
      const trigger = element()
      focusReturn.remember(trigger)
      focusReturn.handOff()

      const first = event()
      focusReturn.restore(first, true)
      expect(first.prevented).toBe(true)
      expect(trigger.focused).toBe(0)
    })

    it("leaves Radix's own focus return when no menu opened the first dialog", () => {
      const focusReturn = createFocusReturn()
      focusReturn.handOff()
      const first = event()
      focusReturn.restore(first, false)
      expect(first.prevented).toBe(false)

      // And the hand-off is spent, so the second close is Radix's too.
      const second = event()
      focusReturn.restore(second, true)
      expect(second.prevented).toBe(false)
    })

    it('is cancelled by a fresh menu opening a dialog', () => {
      const focusReturn = createFocusReturn()
      focusReturn.handOff()
      const trigger = element()
      focusReturn.remember(trigger)

      focusReturn.restore(event(), true)
      expect(trigger.focused).toBe(1)
    })
  })
})
