import { BrowserWindow, clipboard, dialog, ipcMain, nativeTheme } from 'electron'
import type { IpcArgs, IpcChannel, IpcReturn } from '../../shared/ipc-contract'
import { serializeError } from '../../shared/errors'
import { ok, err, type IpcResult } from '../../shared/result'
import type { GitRunner } from '../services/git/git-runner'
import { setGitDebug } from '../services/git/git-executor'
import type { Store } from '../services/persistence/store'
import type { ProjectService } from '../services/projects'
import type { GitService } from '../services/git/git-service'
import type { PresetService } from '../services/presets'
import type { AutomationRunner } from '../services/automation'
import { worktreeNoteKey } from '../../shared/persisted'
import { applicationPickerOptions } from '../services/system/pickers'

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
  presets: PresetService
  automation: AutomationRunner
}

export function registerIpcHandlers({
  gitRunner,
  store,
  projects,
  gitService,
  presets,
  automation
}: IpcDeps): void {
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

  handle('system:pickApplication', async () => {
    const scripted = process.env['ARBORIST_PICK_APPLICATION']
    if (scripted) return scripted

    const options = applicationPickerOptions(process.platform)
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('projects:list', () => projects.list())
  handle('projects:add', (path) => projects.add(path))
  handle('projects:remove', (id) => projects.remove(id))

  handle('worktrees:list', (repoPath) =>
    gitService.listWorktrees(repoPath, store.data.settings.refreshConcurrency)
  )

  handle('branches:exists', (repoPath, branch) => gitService.branchExists(repoPath, branch))
  handle('branches:remote', (repoPath) => gitService.listRemoteBranches(repoPath))
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

  handle(
    'automation:script',
    (repositoryId) =>
      store.data.automationScripts.find((script) => script.repositoryId === repositoryId)
        ?.command ?? ''
  )

  handle('automation:setScript', async (repositoryId, script) => {
    await store.update((data) => {
      const existing = data.automationScripts.find((entry) => entry.repositoryId === repositoryId)
      if (!script.trim()) {
        data.automationScripts = data.automationScripts.filter(
          (entry) => entry.repositoryId !== repositoryId
        )
      } else if (existing) {
        existing.command = script
      } else {
        data.automationScripts.push({ repositoryId, command: script })
      }
    })
  })

  handle('automation:start', (options) => {
    const script =
      store.data.automationScripts.find((entry) => entry.repositoryId === options.repositoryId)
        ?.command ?? ''
    return automation.start({
      script,
      worktreePath: options.worktreePath,
      values: options.values,
      startIndex: options.startIndex
    })
  })

  handle('automation:cancel', (runId) => automation.cancel(runId))

  handle('presets:list', (repoPath, projectId) => presets.list(repoPath, projectId))
  handle('presets:catalogue', () => presets.catalogue())
  handle('presets:setEnabled', (presetId, enabled) => presets.setEnabled(presetId, enabled))
  handle('presets:setOverride', (projectId, presetId, override) =>
    presets.setOverride(projectId, presetId, override)
  )
  handle('presets:save', (preset) => presets.save(preset))
  handle('presets:delete', (presetId) => presets.remove(presetId))
  handle('presets:reorder', (orderedIds) => presets.reorder(orderedIds))
  handle('presets:run', (presetId, context) => presets.run(presetId, context))

  handle('repos:fetch', (repoPath) => gitService.fetchAll(repoPath))
  handle('commits:recent', (repoPath, ref, limit, skip) =>
    gitService.commitLog(repoPath, ref, limit, skip)
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

  handle('settings:get', () => store.data.settings)

  handle('settings:update', async (changes) => {
    await store.update((data) => {
      data.settings = { ...data.settings, ...changes }
    })
    const settings = store.data.settings
    setGitDebug(settings.debugGit)
    // The native theme drives the window chrome, which the renderer's class
    // cannot reach.
    nativeTheme.themeSource = settings.theme
    if (changes.gitPath !== undefined) gitRunner.locator.setOverride(settings.gitPath)
    return settings
  })

  handle('store:status', () => ({
    corruptWarning: store.corruptWarning,
    readOnlyReason: store.readOnlyReason
  }))
}
