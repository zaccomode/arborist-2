import type { IpcArgs, IpcChannel, IpcReturn } from '@shared/ipc-contract'
import { deserializeError } from '@shared/errors'

/**
 * Invokes a main-process handler and unwraps the IpcResult envelope,
 * throwing a typed AppError on failure so callers (and later TanStack
 * Query) see plain rejections.
 */
export async function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcReturn<C>> {
  const result = await window.arborist.invoke(channel, ...args)
  if (!result.ok) {
    throw deserializeError(result.error)
  }
  return result.value
}
