import { z } from 'zod'

export const SCHEMA_VERSION = 1

/**
 * Persisted data, schema version 1. M1 fills in the real repository,
 * preset, and settings shapes; M0 only needs the versioned envelope.
 */
export const persistedDataSchema = z.object({
  schemaVersion: z.number().int().positive(),
  repositories: z.array(z.unknown()).default([]),
  settings: z.record(z.string(), z.unknown()).default({})
})

export type PersistedData = z.infer<typeof persistedDataSchema>

export function defaultData(): PersistedData {
  return { schemaVersion: SCHEMA_VERSION, repositories: [], settings: {} }
}
