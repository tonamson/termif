import { test, expect, _electron as electron } from '@playwright/test'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Local-only smoke: no encryption, no sync. The single portable file is
 * termif.sqlite — add a host, restart, copy the file to a fresh directory,
 * and it appears without any prompt (spec §3, plan 6 task 11).
 */

async function launch(userData: string) {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

function copyDatabase(fromDir: string, toDir: string) {
  copyFileSync(join(fromDir, 'termif.sqlite'), join(toDir, 'termif.sqlite'))
  for (const suffix of ['-wal', '-shm']) {
    const src = join(fromDir, `termif.sqlite${suffix}`)
    if (existsSync(src)) copyFileSync(src, join(toDir, `termif.sqlite${suffix}`))
  }
}

test('adds a host and keeps it across a restart', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-e2e-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    // Empty database boots straight to the host list.
    await expect(window.getByText(/No hosts yet/i)).toBeVisible()

    await window.getByRole('button', { name: /Add host/i }).click()
    await window.locator('#host-label').fill('e2e-host')
    await window.locator('#host-hostname').fill('e2e.example.com')
    await window.locator('#host-username').fill('tester')
    await window.getByRole('button', { name: /^Save$/i }).click()

    await expect(window.getByText('e2e-host')).toBeVisible()
    await app.close()

    const restarted = await launch(userData)
    const restartedWindow = await restarted.firstWindow()

    // Same file, same hosts — no prompt on restart.
    await expect(restartedWindow.getByText('e2e-host')).toBeVisible()

    await restarted.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('copying termif.sqlite makes the host appear on a fresh user-data dir without any prompt', async () => {
  const userDataA = mkdtempSync(join(tmpdir(), 'termif-e2e-A-'))
  const userDataB = mkdtempSync(join(tmpdir(), 'termif-e2e-B-'))
  try {
    const appA = await launch(userDataA)
    const windowA = await appA.firstWindow()

    await expect(windowA.getByText(/No hosts yet/i)).toBeVisible()
    await windowA.getByRole('button', { name: /Add host/i }).click()
    await windowA.locator('#host-label').fill('portable-host')
    await windowA.locator('#host-hostname').fill('portable.example.com')
    await windowA.locator('#host-username').fill('tester')
    await windowA.getByRole('button', { name: /^Save$/i }).click()
    await expect(windowA.getByText('portable-host')).toBeVisible()
    await appA.close()

    // B starts empty — copying only the sqlite file ports the host.
    expect(existsSync(join(userDataB, 'termif.sqlite'))).toBe(false)
    expect(existsSync(join(userDataB, 'secure.json'))).toBe(false)
    expect(existsSync(join(userDataB, 'known_hosts'))).toBe(false)

    copyDatabase(userDataA, userDataB)

    const appB = await launch(userDataB)
    const windowB = await appB.firstWindow()

    await expect(windowB.getByText('portable-host')).toBeVisible()

    await appB.close()
  } finally {
    rmSync(userDataA, { recursive: true, force: true })
    rmSync(userDataB, { recursive: true, force: true })
  }
})
