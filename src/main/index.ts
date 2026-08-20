import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/register'
import { buildAppMenu } from './menu'
import { Store } from './services/persistence/store'
import {
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

const DEFAULT_WINDOW: WindowState = { width: 1100, height: 720, maximized: false }

let store: Store | null = null

function createWindow(state: WindowState, windowStatePath: string): void {
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
  electronApp.setAppUserModelId('com.zeitgeist.arborist')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  const { store: loadedStore } = await Store.load(join(userData, 'arborist-data.json'))
  store = loadedStore

  setGitDebug(store.data.settings.debugGit)
  nativeTheme.themeSource = store.data.settings.theme
  buildAppMenu()
  const gitRunner = new GitRunner(
    new GitLocator(systemDiscoveryDeps(), store.data.settings.gitPath)
  )

  const automation = new AutomationRunner(
    (event) => {
      // One window, so every push goes to it; a second window would need the
      // sender threaded through the handler instead.
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('automation:event', event)
      }
    },
    () => store!.data.settings
  )

  registerIpcHandlers({
    gitRunner,
    store,
    projects: new ProjectService(store, gitRunner),
    gitService: new GitService(gitRunner),
    presets: new PresetService(store, gitRunner),
    automation
  })

  const windowStatePath = join(userData, 'window-state.json')
  const windowState = await loadWindowState(windowStatePath, DEFAULT_WINDOW)
  createWindow(windowState, windowStatePath)

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
