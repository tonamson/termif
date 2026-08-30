import { test, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Not an assertion suite. jsdom cannot render, so this captures the real
 * window for a human to look at. Deliberately no pixel comparison: it would
 * break on every colour change and become debt (spec §4).
 */
test('captures the main screens', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-shot-'))
  const shots = join(__dirname, '__screens__')

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })
  const window = await app.firstWindow()

  await window.getByText(/No hosts yet/i).waitFor()
  await window.screenshot({ path: join(shots, '01-empty.png') })

  await window.getByRole('searchbox').waitFor()
  await window.screenshot({ path: join(shots, '02-empty-sidebar.png') })

  await window.getByRole('button', { name: /add host/i }).click()
  await window.screenshot({ path: join(shots, '03-host-form.png') })

  await window.getByLabel(/^label/i).fill('web-1')
  await window.getByLabel(/hostname/i).fill('web1.example.com')
  await window.getByLabel(/username/i).fill('deploy')
  await window.getByRole('button', { name: /^save/i }).click()

  await window.getByText('web-1').waitFor()
  await window.screenshot({ path: join(shots, '04-host-list.png') })

  // Hovering a row is what reveals its actions, so capture that state too.
  await window.getByText('web-1').hover()
  await window.screenshot({ path: join(shots, '05-host-hover.png') })

  await window.getByRole('tab', { name: /files/i }).click()
  await window.screenshot({ path: join(shots, '06-files.png') })

  await window.getByRole('tab', { name: /forwards/i }).click()
  await window.screenshot({ path: join(shots, '07-forwards.png') })

  await app.close()
  rmSync(userData, { recursive: true, force: true })
})
