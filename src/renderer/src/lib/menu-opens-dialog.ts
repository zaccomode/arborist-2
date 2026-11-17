import { useState } from 'react'
import { createFocusReturn, createMenuCloseGuard } from '@shared/menu-dialog-focus'

/**
 * Shared by every dialog a menu opens. Only one modal dialog is open at a
 * time, and the dialog is often rendered far from the menu that opened it
 * (Delete worktree and Settings live in App.tsx), so the trigger to return to
 * is held here rather than passed down.
 */
const focusReturn = createFocusReturn<HTMLElement>()

/**
 * For a dropdown menu with items that open a dialog. See
 * `@shared/menu-dialog-focus` for the two focus problems this solves.
 *
 * - `attachTrigger` is the menu trigger button's `ref`.
 * - `onCloseAutoFocus` goes on the menu's `DropdownMenuContent`.
 * - `opensDialog()` is called first thing in the `onSelect` of each item that
 *   opens a dialog.
 *
 * The dialog itself takes `returnFocusToMenu` as its content's
 * `onCloseAutoFocus`.
 *
 * Destructure the result rather than keeping it as one object: the React
 * Compiler lint sees an object whose member is passed as a `ref` as a ref
 * itself, and then flags reading its other members during render.
 */
export function useMenuOpensDialog<T extends HTMLElement = HTMLButtonElement>(): {
  attachTrigger: (element: T | null) => void
  onCloseAutoFocus: (event: Event) => void
  opensDialog: () => void
} {
  // One stable object per menu. The trigger is held in a closure through a
  // callback ref rather than a `useRef`, so nothing here reads a ref during
  // render and the handlers can be passed straight to props.
  const [menu] = useState(() => {
    const guard = createMenuCloseGuard()
    let trigger: T | null = null
    return {
      attachTrigger: (element: T | null) => {
        trigger = element
      },
      onCloseAutoFocus: guard.onCloseAutoFocus,
      opensDialog: () => {
        guard.markOpening()
        focusReturn.remember(trigger)
      }
    }
  })
  return menu
}

/** A dialog content's `onCloseAutoFocus`, for dialogs a menu can open. */
export function returnFocusToMenu(event: Event): void {
  const active = document.activeElement
  focusReturn.restore(event, active === null || active === document.body)
}

/**
 * Called by a dialog a menu opened just before it closes to open a second
 * dialog in its place, so focus returns to the menu after the second one
 * (#156). See `FocusReturn.handOff`.
 */
export function handOffFocusReturn(): void {
  focusReturn.handOff()
}
