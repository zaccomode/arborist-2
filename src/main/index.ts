import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/register'
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
  const gitRunner = new GitRunner(
    new GitLocator(systemDiscoveryDeps(), store.data.settings.gitPath)
  )

  registerIpcHandlers({
    gitRunner,
    store,
    projects: new ProjectService(store, gitRunner),
    gitService: new GitService(gitRunner)
  })

  const windowStatePath = join(userData, 'window-state.json')
  const windowState = await loadWindowState(windowStatePath, DEFAULT_WINDOW)
  createWindow(windowState, windowStatePath)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(windowState, windowStatePath)
  })
})

app.on('before-quit', () => {
  void store?.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
