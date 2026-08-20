import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Electron apps get one instance at a time.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list'
})
