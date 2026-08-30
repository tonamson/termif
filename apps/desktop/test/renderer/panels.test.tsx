import { describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MainLayout } from '../../src/renderer/app/MainLayout.js'
import { bootApp } from '../../src/renderer/state/boot.js'
import { fakePlatform } from './fakes/platform.js'

vi.mock('../../src/renderer/state/connectFlow.js', () => ({
  useConnectFlow: () => ({ start: vi.fn().mockResolvedValue(undefined), lastError: null, prompt: null }),
}))

async function boot() {
  const platform = await fakePlatform()
  return bootApp(platform)
}

function fakeSessions() {
  return {
    hostStates: () => new Map(),
    onSessionState: () => () => {},
    onTabClosed: () => () => {},
    connectedHostIds: () => [],
    openSessionIds: () => [],
  } as any
}

describe('MainLayout panels', () => {
  it('launches on the terminal panel with no files panel in the DOM', async () => {
    const app = await boot()
    ;(app as any).sessions = fakeSessions()
    render(<MainLayout app={app} />)

    expect(screen.getByRole('tab', { name: /terminal/i })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-panel="terminal"]')).not.toHaveAttribute('hidden')
    expect(document.querySelector('[data-panel="files"]')).toBeNull()
    expect(document.querySelector('.drawer')).toBeNull()
  })

  it('files panel replaces the terminal view; terminal stays mounted and hidden', async () => {
    const app = await boot()
    ;(app as any).sessions = fakeSessions()
    render(<MainLayout app={app} />)

    await userEvent.click(screen.getByRole('tab', { name: /files/i }))

    expect(screen.getByText(/Connect to a host to browse/i)).toBeInTheDocument()
    expect(document.querySelector('[data-panel="terminal"]')).toHaveAttribute('hidden')
  })

  it('Escape inside the files panel returns to the terminal', async () => {
    const app = await boot()
    ;(app as any).sessions = fakeSessions()
    render(<MainLayout app={app} />)

    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    const files = document.querySelector('[data-panel="files"]')!
    await act(async () => {
      files.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(document.querySelector('[data-panel="files"]')).toBeNull()
    expect(document.querySelector('[data-panel="terminal"]')).not.toHaveAttribute('hidden')
  })

  it('connecting a host switches to the terminal panel before starting', async () => {
    const app = await boot()
    ;(app as any).sessions = fakeSessions()
    await app.store.upsertHost({ label: 'web-1', hostname: 'web1.example.com', port: 22, username: 'deploy', authRef: null, tags: [], groupId: null })
    render(<MainLayout app={app} />)
    await screen.findByText('web-1')

    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    // HostList's connect button is `aria-label={t('host.connect')}` → "Connect".
    await userEvent.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(document.querySelector('[data-panel="files"]')).toBeNull()
    expect(document.querySelector('[data-panel="terminal"]')).not.toHaveAttribute('hidden')
  })
})
