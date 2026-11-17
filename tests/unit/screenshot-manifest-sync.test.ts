import { readFile } from 'fs/promises'
import * as prettier from 'prettier'
import { describe, expect, it } from 'vitest'
import { scenarios } from '../../scripts/screenshots/scenarios'
import { MANIFEST_PATH, README_PATH, THEMES } from '../../scripts/screenshots/output'
import {
  parseManifest,
  renderKeyScreens,
  replaceKeyScreens
} from '../../scripts/screenshots/manifest'

/**
 * The committed manifest and README against the scenarios they were generated
 * from (#155). A PR that adds, renames or removes a scenario without
 * regenerating would otherwise pass CI, and its "before" images and the
 * key-screens table would point at captures that don't exist.
 */
describe('docs/screenshots stays in step with the scenarios', () => {
  it('has a manifest entry for exactly the scenarios that exist', async () => {
    const manifest = parseManifest(await readFile(MANIFEST_PATH, 'utf8'))

    expect(Object.keys(manifest).sort()).toEqual(scenarios.map((s) => s.name).sort())
  })

  it('records both themes for every captured step', async () => {
    const manifest = parseManifest(await readFile(MANIFEST_PATH, 'utf8'))

    for (const [scenario, steps] of Object.entries(manifest)) {
      for (const [step, themes] of Object.entries(steps)) {
        expect(Object.keys(themes).sort(), `${scenario} · ${step || '(final)'}`).toEqual(
          [...THEMES].sort()
        )
      }
    }
  })

  it('has the key-screens table the manifest generates', async () => {
    const manifest = parseManifest(await readFile(MANIFEST_PATH, 'utf8'))
    const readme = await readFile(README_PATH, 'utf8')
    const keyScenarios = scenarios.flatMap((s) => (s.key ? [{ name: s.name, key: s.key }] : []))

    const regenerated = replaceKeyScreens(readme, renderKeyScreens(manifest, keyScenarios, THEMES))
    const options = await prettier.resolveConfig(README_PATH)
    const formatted = await prettier.format(regenerated, { ...options, filepath: README_PATH })

    expect(readme).toBe(formatted)
  })
})
