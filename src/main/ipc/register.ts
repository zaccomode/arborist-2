import { ipcMain } from 'electron'
import type { IpcArgs, IpcChannel, IpcReturn } from '../../shared/ipc-contract'
import { serializeError } from '../../shared/errors'
import { ok, err, type IpcResult } from '../../shared/result'

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

export function registerIpcHandlers(): void {
  handle('system:ping', () => 'pong')
}
