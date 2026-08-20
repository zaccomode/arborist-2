/**
 * Sequential numbered migrations. `migrations[n]` upgrades data from schema
 * version n to n+1. Empty until schema version 2 exists.
 */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>

export const migrations: Record<number, Migration> = {}

export function migrate(
  data: Record<string, unknown>,
  fromVersion: number,
  toVersion: number
): Record<string, unknown> {
  let current = data
  for (let version = fromVersion; version < toVersion; version++) {
    const migration = migrations[version]
    if (!migration) {
      throw new Error(`No migration registered for schema version ${version}`)
    }
    current = { ...migration(current), schemaVersion: version + 1 }
  }
  return current
}
