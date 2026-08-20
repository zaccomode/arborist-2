import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcArgs, IpcChannel, IpcReturn } from '../../shared/ipc-contract'
import { serializeError } from '../../shared/errors'
import { ok, err, type IpcResult } from '../../shared/result'
import type { GitRunner } from '../services/git/git-runner'
import type { Store } from '../services/persistence/store'
import type { ProjectService } from '../services/projects'
import type { GitService } from '../services/git/git-service'

type Handler<C extends IpcChannel> = (...args: IpcArgs<C>) => Promise<IpcReturn<C>> | IpcReturn<C>

/**
 * Registers an invoke handler that wraps its result in the shared
 * `IpcResult` envelope so typed errors survive the process boundary.
 */
export function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<IpcReturn<C>>> => {
    try {
      return ok(await handler(...(args as IpcArgs<C>)))
    } catch (error) {
      return err(serializeError(error))
    }
  })
}

export interface IpcDeps {
  gitRunner: GitRunner
  store: Store
  projects: ProjectService
  gitService: GitService
}

export function registerIpcHandlers({ gitRunner, store, projects, gitService }: IpcDeps): void {
  handle('system:pickFolder', async () => {
    // A native dialog cannot be driven by Playwright, so e2e tests and
    // screenshot scenarios say up front what the user would have chosen.
    const scripted = process.env['ARBORIST_PICK_FOLDER']
    if (scripted) return scripted

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Choose a git repository'
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('projects:list', () => projects.list())
  handle('projects:add', (path) => projects.add(path))
  handle('projects:remove', (id) => projects.remove(id))

  handle('worktrees:list', (repoPath) =>
    gitService.listWorktrees(repoPath, store.data.settings.refreshConcurrency)
  )

  handle('git:discover', () => gitRunner.locator.discover())

  handle('git:setPath', async (path) => {
    const trimmed = path?.trim() ? path.trim() : null
    await store.update((data) => {
      data.settings.gitPath = trimmed
    })
    gitRunner.locator.setOverride(trimmed)
    return gitRunner.locator.discover()
  })

  handle('store:status', () => ({
    corruptWarning: store.corruptWarning,
    readOnlyReason: store.readOnlyReason
  }))
}
