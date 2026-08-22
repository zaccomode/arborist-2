import { app, screen, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import type { IpcEventChannel, IpcEventContract } from '../shared/ipc-contract'
import type { UpdateStatus } from '../shared/updates'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/register'
import { buildAppMenu } from './menu'
import { Store } from './services/persistence/store'
import {
  clampToDisplays,
  loadWindowState,
  trackWindowState,
  type WindowState
} from './services/persistence/window-state'
import { GitLocator, systemDiscoveryDeps } from './services/git/git-discovery'
import { GitRunner } from './services/git/git-runner'
import { setGitDebug } from './services/git/git-executor'
import { ProjectService } from './services/projects'
import { GitService } from './services/git/git-service'
import { PresetService } from './services/presets'
import { AutomationRunner } from './services/automation'
import { UpdateService } from './services/updates'

const DEFAULT_WINDOW: WindowState = { width: 1100, height: 720, maximized: false }

/**
 * The update state a screenshot scenario or an e2e test asked for. Reaching
 * either of these for real means publishing a release, so they are scripted
 * the same way the missing-git screen is.
 */
function scriptedUpdateStatus(): UpdateStatus | undefined {
  switch (process.env['ARBORIST_FAKE_UPDATE']) {
    case 'downloading':
      return { phase: 'downloading', version: '2.1.0', percent: 42 }
    case 'ready':
      return { phase: 'ready', version: '2.1.0' }
    case 'up-to-date':
      // Fixed, because a real timestamp would change the pixels every run.
      return { phase: 'up-to-date', checkedAt: '2026-08-21T09:00:00Z', manual: true }
    default:
      return undefined
  }
}

let store: Store | null = null

function createWindow(remembered: WindowState, windowStatePath: string): void {
  // Re-checked at creation rather than at load, so a window opened by
  // `activate` after a monitor was unplugged lands somewhere visible too.
  const primary = screen.getPrimaryDisplay()
  const others = screen.getAllDisplays().filter((display) => display.id !== primary.id)
  const state = clampToDisplays(
    remembered,
    [primary, ...others].map((display) => display.workArea)
  )

  const mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Arborist',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  if (state.maximized) mainWindow.maximize()
  trackWindowState(mainWindow, windowStatePath)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Must match electron-builder.yml's appId, or Windows treats the running
  // app and its installed shortcut as two different applications and the
  // taskbar shows two icons.
  electronApp.setAppUserModelId('com.isaacshea.arborist2')

  app.setAboutPanelOptions({
    applicationName: 'Arborist',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Isaac Shea',
    credits: 'A git worktree manager.'
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  const { store: loadedStore } = await Store.load(join(userData, 'arborist-data.json'))
  store = loadedStore

  setGitDebug(store.data.settings.debugGit)
  nativeTheme.themeSource = store.data.settings.theme

  const broadcast = <C extends IpcEventChannel>(channel: C, payload: IpcEventContract[C]): void => {
    // One window, so every push goes to it; a second window would need the
    // sender threaded through the handler instead.
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(channel, payload)
    }
  }

  const updates = new UpdateService({
    updater: autoUpdater,
    emit: (status) => broadcast('updates:changed', status),
    currentVersion: app.getVersion(),
    // `isPackaged` is the honest test: a dev run and an unpacked build both
    // have no installer to hand a downloaded update to.
    supported: app.isPackaged,
    initialStatus: scriptedUpdateStatus()
  })

  buildAppMenu(() => void updates.check(true))
  const gitRunner = new GitRunner(
    new GitLocator(systemDiscoveryDeps(), store.data.settings.gitPath)
  )

  const automation = new AutomationRunner(
    (event) => broadcast('automation:event', event),
    () => store!.data.settings
  )

  registerIpcHandlers({
    gitRunner,
    store,
    projects: new ProjectService(store, gitRunner),
    gitService: new GitService(gitRunner),
    presets: new PresetService(store, gitRunner, (script, cwd, values) =>
      // A shell preset is a one-command script with the worktree as its
      // working directory, so it rides the automation runner rather than
      // growing a second way to spawn a shell.
      automation.start({ script, worktreePath: cwd, values })
    ),
    automation,
    updates
  })

  const windowStatePath = join(userData, 'window-state.json')
  const windowState = await loadWindowState(windowStatePath, DEFAULT_WINDOW)
  createWindow(windowState, windowStatePath)

  updates.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(windowState, windowStatePath)
  })
})

let flushing = false

app.on('before-quit', (event) => {
  // Quitting is otherwise faster than the store's write debounce, so a note
  // typed a moment ago would never reach disk. Hold the quit until it has.
  if (flushing || !store) return
  event.preventDefault()
  flushing = true
  store
    .flush()
    .catch((error: unknown) => console.error('Failed to save on quit:', error))
    .finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
