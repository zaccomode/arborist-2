import { test, expect, _electron as electron } from '@playwright/test'

// Requires a prior `electron-vite build` (the pretest:e2e script handles it):
// launching `.` resolves package.json "main" -> out/main/index.js.
test('app boots, renders the shell, and IPC ping round-trips', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await expect(window.getByRole('heading', { name: 'Arborist' })).toBeVisible()

  await window.getByRole('button', { name: 'Ping main process' }).click()
  await expect(window.getByTestId('ping-result')).toHaveText('pong')

  await app.close()
})
