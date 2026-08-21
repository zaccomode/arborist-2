import { promises as fs } from 'fs'
import type { BrowserWindow } from 'electron'

const SAVE_DEBOUNCE_MS = 400

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

/** A display's usable area, as Electron's `screen` module reports it. */
export interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

/** Enough of the window has to land on a display for it to be grabbable. */
const MIN_VISIBLE = 80

function overlap(
  state: WindowState & { x: number; y: number },
  area: DisplayArea
): { width: number; height: number } {
  const width = Math.min(state.x + state.width, area.x + area.width) - Math.max(state.x, area.x)
  const height = Math.min(state.y + state.height, area.y + area.height) - Math.max(state.y, area.y)
  return { width, height }
}

/**
 * Pulls remembered bounds back onto a display that currently exists.
 *
 * The case this is for is a laptop: undock it, and the window it remembers is
 * at x=2400 on a monitor that is no longer there. Electron will happily open
 * it there, entirely off-screen, and the app then looks like it failed to
 * launch. A window that overlaps every display by less than a title bar's
 * worth is treated as lost, and re-centred on the primary display at a size
 * that fits it.
 *
 * A window that does reach a display is left exactly where it was, including
 * one deliberately straddling two monitors — dragging it back onto one would
 * be this function inventing a layout the user did not ask for.
 *
 * `displays[0]` is the primary; the caller passes them in that order.
 */
export function clampToDisplays(state: WindowState, displays: readonly DisplayArea[]): WindowState {
  const primary = displays[0]
  if (!primary) return state

  if (state.x !== undefined && state.y !== undefined) {
    const positioned = state as WindowState & { x: number; y: number }
    const visible = displays.some((area) => {
      const { width, height } = overlap(positioned, area)
      return width >= MIN_VISIBLE && height >= MIN_VISIBLE
    })
    if (visible) return state
  }

  const width = Math.min(state.width, primary.width)
  const height = Math.min(state.height, primary.height)
  return {
    ...state,
    width,
    height,
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2)
  }
}

/**
 * Window bounds live in their own file. They change on every drag of the
 * window, and rewriting the main data file that often would put the notes and
 * presets it holds through a save they never asked for.
 */
export async function loadWindowState(
  filePath: string,
  defaults: WindowState
): Promise<WindowState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<WindowState>
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return defaults
    return {
      width: parsed.width,
      height: parsed.height,
      x: typeof parsed.x === 'number' ? parsed.x : undefined,
      y: typeof parsed.y === 'number' ? parsed.y : undefined,
      maximized: parsed.maximized === true
    }
    // Unlike the data file, a bad read here is not worth telling anyone
    // about: the cost is a window opening at its default size.
  } catch {
    return defaults
  }
}

/** Persists the window's bounds as it moves, and on close. */
export function trackWindowState(window: BrowserWindow, filePath: string): void {
  let timer: NodeJS.Timeout | null = null

  const save = async (): Promise<void> => {
    if (window.isDestroyed()) return
    const bounds = window.getNormalBounds()
    const state: WindowState = { ...bounds, maximized: window.isMaximized() }
    try {
      await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8')
    } catch {
      // As above: losing the remembered size is not worth a dialog.
    }
  }

  const scheduleSave = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void save()
    }, SAVE_DEBOUNCE_MS)
  }

  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  window.on('close', () => {
    if (timer) clearTimeout(timer)
    void save()
  })
}
