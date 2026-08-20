import { ipcMain } from 'electron'
import type { IpcArgs, IpcChannel, IpcReturn } from '../../shared/ipc-contract'
import { serializeError } from '../../shared/errors'
import { ok, err, type IpcResult } from '../../shared/result'
import type { GitRunner } from '../services/git/git-runner'
import type { Store } from '../services/persistence/store'

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
}

export function registerIpcHandlers({ gitRunner, store }: IpcDeps): void {
  handle('system:ping', () => 'pong')

  handle('git:discover', () => gitRunner.locator.discover())

  handle('git:setPath', async (path) => {
    const trimmed = path?.trim() ? path.trim() : null
    store.mutate((data) => {
      data.settings['gitPath'] = trimmed
    })
    await store.flush()
    gitRunner.locator.setOverride(trimmed)
    return gitRunner.locator.discover()
  })
}
