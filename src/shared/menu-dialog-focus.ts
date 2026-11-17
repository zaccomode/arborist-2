/**
 * Focus handling for a menu item that opens a dialog (#146, #147).
 *
 * Two things go wrong when a Radix dropdown menu item opens a dialog:
 *
 * 1. On closing, the menu hands focus back to its trigger, but only after its
 *    exit animation. By then the dialog's text box already has focus, so the
 *    menu takes it away. The dialog's focus trap takes it back, but keys typed
 *    in between are lost (CI dropped "featu" from "feature-remote").
 *    `createMenuCloseGuard` suppresses that one focus return.
 *
 * 2. On closing, the dialog returns focus to whatever had it when it opened:
 *    the menu item, which has since unmounted, so focus falls to `<body>`.
 *    `createFocusReturn` remembers the menu's trigger instead and puts focus
 *    back there.
 *
 * Kept free of React and the DOM so it can be unit tested; the renderer's
 * `useMenuOpensDialog` hook wires it up.
 */

export interface Focusable {
  focus(): void
  readonly isConnected: boolean
}

export interface PreventableEvent {
  preventDefault(): void
}

export interface MenuCloseGuard {
  /** Call from the menu item's `onSelect`, before opening the dialog. */
  markOpening(): void
  /** The menu content's `onCloseAutoFocus`. */
  onCloseAutoFocus(event: PreventableEvent): void
}

/** One per menu: skips the menu's focus return once, after an item opened a dialog. */
export function createMenuCloseGuard(): MenuCloseGuard {
  let opening = false
  return {
    markOpening() {
      opening = true
    },
    onCloseAutoFocus(event) {
      if (!opening) return
      opening = false
      event.preventDefault()
    }
  }
}

export interface FocusReturn<T extends Focusable> {
  /** Remember where focus goes once the dialog that is opening closes. */
  remember(target: T | null): void
  /**
   * The dialog content's `onCloseAutoFocus`. `focusIsFree` says whether
   * nothing else holds focus by now (it is on `<body>`). When something does,
   * such as the commit box that "Commit first" focuses, it is left there.
   *
   * The target is forgotten either way, so a dialog opened some other way
   * later (a button, the app menu) keeps Radix's own focus return.
   */
  restore(event: PreventableEvent, focusIsFree: boolean): void
  /**
   * Call when the dialog that is open is about to close in favour of a second
   * one, as Delete hands over to Force delete (#156). The next `restore`, the
   * first dialog's, then keeps the target for the second dialog's close
   * instead of spending it, and leaves focus in the second dialog. Without
   * it, the first dialog's close finds focus already taken, discards the
   * target, and the second dialog's close drops focus to `<body>`.
   */
  handOff(): void
}

export function createFocusReturn<T extends Focusable>(): FocusReturn<T> {
  let target: T | null = null
  let handingOff = false
  return {
    remember(next) {
      target = next
      handingOff = false
    },
    handOff() {
      handingOff = true
    },
    restore(event, focusIsFree) {
      if (handingOff) {
        handingOff = false
        // Focus belongs to the dialog taking over. Radix would otherwise try
        // to return it to whatever had it before the first dialog opened.
        if (target) event.preventDefault()
        return
      }
      const returnTo = target
      target = null
      if (!returnTo || !returnTo.isConnected || !focusIsFree) return
      event.preventDefault()
      returnTo.focus()
    }
  }
}
