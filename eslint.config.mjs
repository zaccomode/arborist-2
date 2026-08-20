import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // shadcn ui components export cva variants alongside the component.
    files: ['src/renderer/src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  },
  // Import direction: renderer ↛ main/preload, main/preload ↛ renderer,
  // shared stays pure (no Electron, no Node built-ins).
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main/**', '**/preload/**'],
              message: 'Renderer must not import from main or preload.'
            },
            {
              group: ['electron'],
              message: 'Renderer must use the preload-exposed API, not electron directly.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/renderer/**'],
              message: 'Main and preload must not import from renderer.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'electron',
                'node:*',
                'fs',
                'path',
                'os',
                'child_process',
                'crypto',
                'util',
                'stream'
              ],
              message: 'Shared modules must stay pure: no Electron or Node imports.'
            }
          ]
        }
      ]
    }
  },
  eslintConfigPrettier
)
