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
