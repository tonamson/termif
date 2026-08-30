import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Electron launches are slow, and this suite is one test.
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
})
