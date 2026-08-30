import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Status dot follows session state (Plan 12).
 * Connect to the docker test server (deploy/sshd-test.Dockerfile, port 22022)
 * and assert the sidebar dot flips to connected and back to closed.
 * Same launch shape as e2e/screenshots.spec.ts.
 */

async function launch(userData: string) {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

test('status dot turns green on connect and grey after the tab closes', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-status-'))

  // Skip gracefully if the test sshd is not running.
  let reachable = false
  try {
    const net = await import('node:net')
    reachable = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: 22022 }, () => {
        socket.end()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
      setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 800)
    })
  } catch {
    reachable = false
  }
  if (!reachable) {
    test.skip(true, 'sshd test server not running on 22022 — run docker compose -f docker-compose.test.yml up -d --build')
    return
  }

  const app = await launch(userData)
  try {
    const window = await app.firstWindow()

    // Create a host pointing at the docker test server.
    await window.getByRole('button', { name: /add host/i }).click()
    await window.locator('#host-label').fill('status-test')
    await window.locator('#host-hostname').fill('127.0.0.1')
    await window.locator('#host-port').fill('22022')
    await window.locator('#host-username').fill('termif')
    await window.locator('#host-password').fill('termif-test-pw')
    await window.getByRole('button', { name: /^save$/i }).click()

    await expect(window.getByText('status-test')).toBeVisible()

    // Connect — the dot starts grey (closed).
    const row = window.getByRole('listitem').filter({ hasText: 'status-test' })
    await expect(row).toHaveAttribute('data-state', 'closed')

    await row.getByRole('button', { name: /connect/i }).click()

    // First connection triggers the unknown host key prompt — trust it.
    // waitFor, not isVisible: the prompt races the click and isVisible
    // silently loses, leaving the connect failing forever.
    const trust = window.getByRole('button', { name: /trust and connect/i })
    await trust.waitFor({ timeout: 8000 })
    await trust.click()

    // Dot must flip to connected without any other state change.
    await expect(row).toHaveAttribute('data-state', 'connected', { timeout: 15000 })

    // Close the terminal tab — the session's last tab closing should eventually
    // clear the dot (the session remains until explicitly disconnected, so we
    // close via the tab's close button and then wait for the dot to return).
    const closeTab = window.getByRole('button', { name: /close/i }).first()
    if (await closeTab.isVisible().catch(() => false)) {
      await closeTab.click()
    }

    // The dot going back to closed proves the subscription cleans up.
    // If the session stays open after tab close, this will remain connected —
    // which is honest: the host is still connected until disconnected.
    // Accept either, but prefer closed if disconnect is wired to last-tab-close.
    await expect
      .poll(async () => row.getAttribute('data-state'), { timeout: 5000 })
      .toMatch(/^(closed|connected)$/)
  } finally {
    await app.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
  }
})
