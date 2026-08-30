import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * One end-to-end test, deliberately: it covers the path no unit test can — the
 * real main process, the real preload bridge, the real SQLite file — and stops
 * there. UI churns, and a broad end-to-end suite becomes maintenance debt
 * (spec §8).
 */
test('creates a vault, adds a host, and keeps it across a restart', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-e2e-'))

  const launch = async () =>
    electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test' },
    })

  const app = await launch()
  const window = await app.firstWindow()

  // First run: the vault does not exist yet.
  await expect(window.getByRole('heading', { name: /choose a master password/i })).toBeVisible()

  await window.getByLabel(/enter your master password/i).fill('e2e-test-password')
  await window.getByLabel('Confirm').fill('e2e-test-password')
  await window.getByRole('button', { name: /create vault/i }).click()

  // Add a host.
  await window.getByRole('button', { name: /add host/i }).click()
  await window.getByLabel(/^label/i).fill('e2e-host')
  await window.getByLabel(/hostname/i).fill('e2e.example.com')
  await window.getByLabel(/username/i).fill('tester')
  await window.getByRole('button', { name: /^save/i }).click()

  await expect(window.getByText('e2e-host')).toBeVisible()
  await app.close()

  // Second run: the vault is on disk, so it asks to unlock rather than to set up.
  const restarted = await launch()
  const restartedWindow = await restarted.firstWindow()

  await expect(restartedWindow.getByRole('heading', { name: /vault locked/i })).toBeVisible()
  await restartedWindow.getByLabel(/enter your master password/i).fill('e2e-test-password')
  await restartedWindow.getByRole('button', { name: /^unlock/i }).click()

  // The host survived, which means the local database is doing its job.
  await expect(restartedWindow.getByText('e2e-host')).toBeVisible()

  await restarted.close()
  rmSync(userData, { recursive: true, force: true })
})
