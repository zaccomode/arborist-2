import { describe, it, expect } from 'vitest'
import { applicationPickerOptions } from '../../src/main/services/system/pickers'

describe('applicationPickerOptions', () => {
  it('picks files rather than directories, on every platform', () => {
    // A macOS app is a directory; `openDirectory` greys all of them out,
    // which is the bug this exists to prevent coming back.
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(applicationPickerOptions(platform).properties).toEqual(['openFile'])
    }
  })

  it('starts in /Applications and filters to bundles on macOS', () => {
    const options = applicationPickerOptions('darwin')
    expect(options.defaultPath).toBe('/Applications')
    expect(options.filters).toEqual([{ name: 'Applications', extensions: ['app'] }])
  })

  it('filters to executables on Windows', () => {
    expect(applicationPickerOptions('win32').filters?.[0].extensions).toContain('exe')
  })

  it('does not filter on Linux, where there is no convention to filter by', () => {
    expect(applicationPickerOptions('linux').filters).toBeUndefined()
  })
})
