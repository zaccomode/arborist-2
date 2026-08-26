import { basename } from 'path'
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
import type { UpdateService } from '../services/updates'
import type { WorktreeWatcher } from '../services/watch/worktree-watcher'
import { commitDraftKey, worktreeNoteKey } from '../../shared/persisted'
import { resolveWorktreeLocation } from '../../shared/worktree-location'
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
  updates: UpdateService
  watcher: WorktreeWatcher
}

export function registerIpcHandlers({
  gitRunner,
  store,
  projects,
  gitService,
  presets,
  automation,
  updates,
  watcher
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
  handle('branches:list', (repoPath) => gitService.listLocalBranches(repoPath))
  handle('branches:remote', (repoPath) => gitService.listRemoteBranches(repoPath))
  handle('worktrees:suggestPath', (repoPath, branch, projectId) => {
    const location = resolveWorktreeLocation(
      store.data.settings,
      store.data.projectSettings[projectId]
    )
    const repoName =
      store.data.repositories.find((repo) => repo.id === projectId)?.name ?? basename(repoPath)
    return gitService.suggestWorktreePath(repoPath, branch, location, repoName)
  })
  handle('worktrees:create', (repoPath, options) => gitService.createWorktree(repoPath, options))

  handle('worktrees:isDirty', (worktreePath) => gitService.isDirty(worktreePath))
  handle('workingTree:get', (worktreePath) => gitService.workingTreeChanges(worktreePath))
  handle('diff:get', (request) => gitService.fileDiff(request))
  handle('workingTree:stage', (worktreePath, paths) => gitService.stageFiles(worktreePath, paths))
  handle('workingTree:unstage', (worktreePath, paths) =>
    gitService.unstageFiles(worktreePath, paths)
  )
  handle('worktree:applyHunk', (worktreePath, file, hunkId, direction) =>
    gitService.applyHunk(worktreePath, file, hunkId, direction)
  )
  handle('workingTree:discard', (worktreePath, paths) =>
    gitService.discardFiles(worktreePath, paths)
  )
  handle('workingTree:commit', (worktreePath, message, amend) =>
    gitService.commit(worktreePath, message, amend)
  )
  handle('workingTree:push', (worktreePath, branch, setUpstream) =>
    gitService.push(worktreePath, branch, setUpstream)
  )
  handle('workingTree:hasIdentity', (worktreePath) => gitService.hasIdentity(worktreePath))
  handle('branches:switchPrecheck', (repoPath, worktreePath, branch, create) =>
    gitService.planBranchSwitch(repoPath, worktreePath, branch, create)
  )
  handle('branches:switch', (worktreePath, branch, create) =>
    gitService.switchBranch(worktreePath, branch, create)
  )
  handle('stash:push', (worktreePath, message, includeUntracked, paths) =>
    gitService.stashPush(worktreePath, message, includeUntracked, paths)
  )
  handle('stash:list', (worktreePath) => gitService.listStashes(worktreePath))
  handle('stash:pop', (worktreePath, ref) => gitService.stashPop(worktreePath, ref))
  handle('stash:apply', (worktreePath, ref) => gitService.stashApply(worktreePath, ref))
  handle('stash:drop', (worktreePath, ref) => gitService.stashDrop(worktreePath, ref))
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

  handle('commitDraft:get', (repositoryId, worktreePath) => {
    return store.data.commitDrafts[commitDraftKey(repositoryId, worktreePath)] ?? ''
  })

  handle('commitDraft:set', async (repositoryId, worktreePath, text) => {
    const trimmed = text.trim()
    await store.update((data) => {
      const key = commitDraftKey(repositoryId, worktreePath)
      if (trimmed) data.commitDrafts[key] = trimmed
      else delete data.commitDrafts[key]
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
  handle('commits:recent', (repoPath, refs, limit, skip) =>
    gitService.commitLog(repoPath, refs, limit, skip)
  )
  handle('commits:files', (repoPath, hash) => gitService.commitFiles(repoPath, hash))

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

  handle('projectSettings:get', (projectId) => store.data.projectSettings[projectId] ?? {})

  handle('projectSettings:set', async (projectId, changes) => {
    await store.update((data) => {
      data.projectSettings[projectId] = { ...data.projectSettings[projectId], ...changes }
    })
    return store.data.projectSettings[projectId] ?? {}
  })

  handle('selection:get', () => store.data.selection)

  handle('selection:update', async (changes) => {
    await store.update((data) => {
      data.selection = { ...data.selection, ...changes }
    })
    return store.data.selection
  })

  handle('store:status', () => ({
    corruptWarning: store.corruptWarning,
    readOnlyReason: store.readOnlyReason
  }))

  handle('updates:support', () => updates.support())
  handle('updates:status', () => updates.status)
  handle('updates:check', () => updates.check(true))
  handle('updates:install', () => updates.install())

  handle('watch:select', (worktreePath) => watcher.watch(worktreePath))
}
