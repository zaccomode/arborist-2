/**
 * Sequential numbered migrations. `migrations[n]` upgrades data from schema
 * version n to n+1, and `migrate` applies them in order, so each one only has
 * to know about the step it makes.
 */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>

export const migrations: Record<number, Migration> = {
  /**
   * 1 → 2: the M0 envelope carried an untyped repository list and a loose
   * settings bag. Everything M1 stores is new, and the zod defaults fill it
   * in, so this drops the two fields that changed shape rather than trying to
   * rescue a scaffold nobody shipped.
   */
  1: (data) => {
    const rest = { ...data }
    delete rest.repositories
    delete rest.settings
    return rest
  }
}

export function migrate(
  data: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
  registry: Record<number, Migration> = migrations
): Record<string, unknown> {
  let current = data
  for (let version = fromVersion; version < toVersion; version++) {
    const migration = registry[version]
    if (!migration) {
      throw new Error(`No migration registered for schema version ${version}`)
    }
    current = { ...migration(current), schemaVersion: version + 1 }
  }
  return current
}
