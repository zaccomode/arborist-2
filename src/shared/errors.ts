/**
 * Error types shared across main and renderer.
 *
 * ipcMain mangles Error subclasses when they cross the process boundary, so
 * handlers serialize errors into plain objects and the renderer rehydrates
 * them into thrown `AppError`s.
 */

export interface SerializedError {
  name: string
  message: string
  code: string
}

export class AppError extends Error {
  readonly code: string

  constructor(message: string, code = 'unknown') {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof AppError) {
    return { name: error.name, message: error.message, code: error.code }
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, code: 'unknown' }
  }
  return { name: 'Error', message: String(error), code: 'unknown' }
}

export function deserializeError(serialized: SerializedError): AppError {
  const error = new AppError(serialized.message, serialized.code)
  error.name = serialized.name
  return error
}
