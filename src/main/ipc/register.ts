import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import type { IpcArgs, IpcChannel, IpcReturn } from '../../shared/ipc-contract'
import { serializeError } from '../../shared/errors'
import { ok, err, type IpcResult } from '../../shared/result'
import type { GitRunner } from '../services/git/git-runner'
import type { Store } from '../services/persistence/store'
import type { ProjectService } from '../services/projects'
import type { GitService } from '../services/git/git-service'
import { worktreeNoteKey } from '../../shared/persisted'

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

  handle('branches:exists', (repoPath, branch) => gitService.branchExists(repoPath, branch))
  handle('worktrees:suggestPath', (repoPath, branch) =>
    gitService.suggestWorktreePath(repoPath, branch)
  )
  handle('worktrees:create', (repoPath, options) => gitService.createWorktree(repoPath, options))

  handle('worktrees:isDirty', (worktreePath) => gitService.isDirty(worktreePath))
  handle('worktrees:remove', (repoPath, worktreePath, force) =>
    gitService.removeWorktree(repoPath, worktreePath, force)
  )
  handle('worktrees:prune', (repoPath) => gitService.pruneWorktrees(repoPath))

  handle('notes:get', (repositoryId, worktreePath) => {
    const { notes, worktreeNotes } = store.data
    return worktreePath
      ? (worktreeNotes[worktreeNoteKey(repositoryId, worktreePath)] ?? '')
      : (notes[repositoryId] ?? '')
  })

  handle('notes:set', async (repositoryId, worktreePath, text) => {
    const trimmed = text.trim()
    await store.update((data) => {
      const collection = worktreePath ? data.worktreeNotes : data.notes
      const key = worktreePath ? worktreeNoteKey(repositoryId, worktreePath) : repositoryId
      // An emptied note is a deleted note: storing a blank string would leave
      // a record behind for every worktree anyone ever clicked into.
      if (trimmed) collection[key] = trimmed
      else delete collection[key]
    })
  })

  handle('system:copyText', (text) => {
    clipboard.writeText(text)
  })

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
