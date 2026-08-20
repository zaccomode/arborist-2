import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/register'
import { Store } from './services/persistence/store'
import { GitLocator, systemDiscoveryDeps } from './services/git/git-discovery'
import { GitRunner } from './services/git/git-runner'

let store: Store | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
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

  const { store: loadedStore, warning } = await Store.load(
    join(app.getPath('userData'), 'arborist-data.json')
  )
  store = loadedStore
  if (warning) {
    // M1 surfaces this as a renderer toast; until then it must not be silent.
    console.warn(warning)
  }

  const gitPath = store.data.settings['gitPath']
  const gitRunner = new GitRunner(
    new GitLocator(systemDiscoveryDeps(), typeof gitPath === 'string' ? gitPath : null)
  )

  registerIpcHandlers({ gitRunner, store })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
