import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // better-sqlite3 and the .node module must stay external: bundling a
    // native addon breaks its binding lookup. @termif/core is bundled so
    // electron-builder doesn't need to follow its file: symlink outside the app dir.
    plugins: [externalizeDepsPlugin({ exclude: ['@termif/core'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      include: ['../../test/**/*.test.ts', '../../test/**/*.test.tsx'],
    },
  },
})
