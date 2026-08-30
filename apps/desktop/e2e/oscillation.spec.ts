import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Main-panels spec §6: the document never scrolls and the terminal never
    oscillates. Fails at ~171 RO callbacks / 6 s and scrollHeight 804 > 790
    before the fix; bounded and clean after. */

async function launch(userData: string) {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

test('no document overflow, no resize loop once a session is open', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-osc-'))
  const app = await launch(userData)
  try {
    // Wrap ResizeObserver before any page script runs so every callback —
    // ours and xterm's internal ones — is counted.
    await app.context().addInitScript(() => {
      ;(window as unknown as { __roCount: number }).__roCount = 0
      const Orig = window.ResizeObserver
      window.ResizeObserver = class extends Orig {
        constructor(cb: ResizeObserverCallback) {
          super((entries, obs) => {
            ;(window as unknown as { __roCount: number }).__roCount++
            return cb(entries, obs)
          })
        }
      }
    })
    const window = await app.firstWindow()

    await window.getByRole('button', { name: /add host/i }).click()
    await window.locator('#host-label').fill('osc-test')
    await window.locator('#host-hostname').fill('127.0.0.1')
    await window.locator('#host-port').fill('22022')
    await window.locator('#host-username').fill('termif')
    await window.locator('#host-password').fill('termif-test-pw')
    await window.getByRole('button', { name: /^save$/i }).click()

    // Skip gracefully when the test sshd is not running.
    const reachable = await new Promise<boolean>((resolve) => {
      import('node:net').then(({ createConnection }) => {
        const socket = createConnection({ host: '127.0.0.1', port: 22022 }, () => {
          socket.end()
          resolve(true)
        })
        socket.on('error', () => resolve(false))
      })
    })
    test.skip(!reachable, 'docker test sshd (127.0.0.1:22022) is not running')

    await window.getByText('osc-test').waitFor()
    await window.getByRole('button', { name: /connect/i }).first().click()
    const trust = window.getByRole('button', { name: /trust and connect/i })
    await trust.waitFor({ timeout: 8000 })
    await trust.click()
    await window.locator('.terminal-tabs__tab').first().waitFor({ timeout: 20000 })
    await window.waitForTimeout(3000) // let the shell settle after the prompt

    const before = await window.evaluate(() => (window as unknown as { __roCount: number }).__roCount)
    await window.waitForTimeout(6000)
    const after = await window.evaluate(() => (window as unknown as { __roCount: number }).__roCount)
    const overflow = await window.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      sh: document.documentElement.scrollHeight,
      ch: document.documentElement.clientHeight,
    }))

    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw)
    expect(overflow.sh).toBeLessThanOrEqual(overflow.ch)
    expect(after - before).toBeLessThanOrEqual(10)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
