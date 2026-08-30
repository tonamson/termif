import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * `electron.vite.config.ts` carries its own `test` block, but bare `vitest`
 * does not read it — so the renderer's jsdom environment and the jest-dom
 * matchers must be wired here. The main-process tests stay on Node; the
 * renderer tests (components + stores) get jsdom.
 */
export default defineConfig({
  resolve: {
    alias: {
      'better-sqlite3': path.resolve(__dirname, 'test/__mocks__/better-sqlite3.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    environmentMatchGlobs: [['test/renderer/**', 'jsdom']],
  },
})
