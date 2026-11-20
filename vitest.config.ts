import { devNull } from 'os'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // Every git the suite runs, the app's own executor included, reads no
    // global, system or environment-injected config, so a developer's
    // `insteadOf` rewrites or signing settings can't change what a test sees
    // (#168). Kept in step with `isolatedGitEnv` in the git fixture, which
    // the screenshot runner uses outside vitest; a unit test checks the two
    // agree.
    env: {
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '0',
      GIT_CONFIG_PARAMETERS: ''
    }
  }
})
