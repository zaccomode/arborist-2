import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { IpcEventChannel } from '../shared/ipc-contract'

function send(channel: IpcEventChannel): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  window?.webContents.send(channel, undefined)
}

/**
 * The application menu. It exists mostly for its accelerators and, on macOS,
 * for the Edit roles: without them copy and paste do not work in any text
 * field, because a Mac app gets those from its menu rather than from the web
 * content.
 */
export function buildAppMenu(onCheckForUpdates: () => void): void {
  const isMac = process.platform === 'darwin'

  // A check the user asked for always answers, even when the answer is "you
  // are up to date" — a silent no-op reads as a broken menu item.
  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    click: onCheckForUpdates
  }

  const settingsItem: MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => send('app:openSettings')
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              checkForUpdatesItem,
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Worktree…',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('app:newWorktree')
        },
        ...(isMac ? [] : ([{ type: 'separator' }, settingsItem] as MenuItemConstructorOptions[])),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => send('app:refresh')
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    ...(isMac
      ? ([
          { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    // Windows and Linux have no application menu to hang About off, so they
    // get the Help menu every app on those platforms has instead.
    ...(isMac
      ? []
      : ([
          {
            label: 'Help',
            submenu: [checkForUpdatesItem, { type: 'separator' }, { role: 'about' }]
          }
        ] satisfies MenuItemConstructorOptions[]))
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
