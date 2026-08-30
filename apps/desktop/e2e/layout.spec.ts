import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Geometry invariants for the three exclusive main panels (main-panels spec §6.2). */

async function launch(userData: string) {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

test('terminal fills the main column at launch; no drawer exists', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-layout-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    const main = window.locator('.layout__main')
    const terminal = window.locator('[data-panel="terminal"]')
    await expect(terminal).toBeVisible()
    const mainBox = (await main.boundingBox())!
    const termBox = (await terminal.boundingBox())!
    expect(termBox.height).toBeGreaterThanOrEqual(mainBox.height * 0.8)
    expect(await window.locator('.drawer').count()).toBe(0)
    await app.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('files panel is full-height and hides the terminal', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-layout-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    await window.getByRole('tab', { name: /files/i }).click()
    const files = window.locator('[data-panel="files"]')
    await expect(files).toBeVisible()
    const mainBox = (await window.locator('.layout__main').boundingBox())!
    const filesBox = (await files.boundingBox())!
    expect(filesBox.height).toBeGreaterThanOrEqual(mainBox.height * 0.8)
    await expect(window.locator('[data-panel="terminal"]')).toBeHidden()
    await app.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('returning to the terminal panel shows it again', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-layout-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    await window.getByRole('tab', { name: /files/i }).click()
    await window.getByRole('tab', { name: /terminal/i }).click()
    await expect(window.locator('[data-panel="terminal"]')).toBeVisible()
    await expect(window.locator('[data-panel="files"]')).toHaveCount(0)
    await app.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a connected session survives a files round-trip', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-layout-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    // Add the docker test host the way status.spec.ts seeds it.
    await window.getByRole('button', { name: /Add host/i }).click()
    await window.locator('#host-label').fill('layout-sshd')
    await window.locator('#host-hostname').fill('127.0.0.1')
    await window.locator('#host-port').fill('22022')
    await window.locator('#host-username').fill('tester')
    await window.locator('#host-password').fill('tester')
    await window.getByRole('button', { name: /^Save$/i }).click()

    // Skip gracefully when the test sshd is not running.
    let reachable = false
    try {
      const net = await import('node:net')
      reachable = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port: 22022 }, () => {
          socket.end()
          resolve(true)
        })
        socket.on('error', () => resolve(false))
      })
    } catch {
      reachable = false
    }
    test.skip(!reachable, 'docker test sshd (127.0.0.1:22022) is not running')

    await window.getByText('layout-sshd').dblclick()
    await expect(window.locator('[data-panel="terminal"] .terminal-tabs__tab')).toBeVisible({ timeout: 30_000 })

    await window.getByRole('tab', { name: /files/i }).click()
    await expect(window.locator('[data-panel="files"]')).toBeVisible()
    // Esc returns; the connected tab is still there.
    await window.locator('[data-panel="files"]').press('Escape')
    await expect(window.locator('[data-panel="terminal"] .terminal-tabs__tab')).toBeVisible()
    await app.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})
