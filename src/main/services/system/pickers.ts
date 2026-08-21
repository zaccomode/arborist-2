import type { OpenDialogOptions } from 'electron'

/**
 * The native dialog for choosing an application to open a worktree with.
 *
 * `openFile` rather than `openDirectory` is the whole point on macOS: an app
 * is a bundle, which is a directory, and a directory picker greys every one
 * of them out. Pure, so the per-platform shape is testable without a desktop.
 */
export function applicationPickerOptions(platform: NodeJS.Platform): OpenDialogOptions {
  const options: OpenDialogOptions = {
    properties: ['openFile'],
    title: 'Choose an application'
  }

  if (platform === 'darwin') {
    return {
      ...options,
      defaultPath: '/Applications',
      filters: [{ name: 'Applications', extensions: ['app'] }]
    }
  }
  if (platform === 'win32') {
    return { ...options, filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd'] }] }
  }
  // Linux has no one convention for where executables live or what they are
  // called, so anything goes.
  return options
}
