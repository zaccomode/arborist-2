import type { SerializedError } from './errors'

/** Envelope returned by every IPC invoke handler. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: SerializedError }

export function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

export function err<T = never>(error: SerializedError): IpcResult<T> {
  return { ok: false, error }
}
