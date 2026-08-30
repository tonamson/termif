import { describe, expect, it } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MainLayout } from '../../src/renderer/app/MainLayout.js'
import { bootApp } from '../../src/renderer/state/boot.js'
import { fakePlatform } from './fakes/platform.js'
import type { HostConnectionState } from '@termif/core'

describe('MainLayout status dot', () => {
  it('flips to connected when onSessionState fires without other state changing', async () => {
    const platform = await fakePlatform()
    const app = await bootApp(platform)

    const host = await app.store.upsertHost({
      label: 'web-1',
      hostname: 'web1.example.com',
      port: 22,
      username: 'deploy',
      authRef: null,
      tags: [],
      groupId: null,
    })

    let hostStates: Map<string, HostConnectionState> = new Map()
    const listeners = new Set<(id: bigint, state: string) => void>()
    const fakeSessions: any = {
      hostStates: () => new Map(hostStates),
      onSessionState: (cb: (id: bigint, state: string) => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      onTabClosed: () => () => {},
      connectedHostIds: () => [...hostStates.keys()],
    }
    // Replace sessions with fake that we control
    ;(app as any).sessions = fakeSessions

    render(<MainLayout app={app} />)

    // Wait for host to appear in list
    expect(await screen.findByText('web-1')).toBeInTheDocument()
    const row = screen.getByRole('listitem')
    expect(row).toHaveAttribute('data-state', 'closed')

    // Emit connected for this host without touching any other state
    await act(async () => {
      hostStates = new Map([[host.id, 'connected']])
      for (const cb of [...listeners]) cb(1n, 'connected')
    })

    expect(row).toHaveAttribute('data-state', 'connected')

    // Emit disconnect (closed) -> back to closed
    await act(async () => {
      hostStates = new Map()
      for (const cb of [...listeners]) cb(1n, 'closed')
    })

    expect(row).toHaveAttribute('data-state', 'closed')
  })

  it('shows reconnecting when hostStates says reconnecting', async () => {
    const platform = await fakePlatform()
    const app = await bootApp(platform)

    await app.store.upsertHost({
      label: 'db-1',
      hostname: 'db.example.com',
      port: 22,
      username: 'deploy',
      authRef: null,
      tags: [],
      groupId: null,
    })

    const hostStates: Map<string, HostConnectionState> = new Map([['any', 'reconnecting']])
    // We need the actual host id to test correctly — fetch it
    const hosts = await app.store.listHosts()
    const hostId = hosts[0]!.id
    const map = new Map<string, HostConnectionState>([[hostId, 'reconnecting']])

    const fakeSessions: any = {
      hostStates: () => new Map(map),
      onSessionState: () => () => {},
      onTabClosed: () => () => {},
      connectedHostIds: () => [...map.keys()],
    }
    ;(app as any).sessions = fakeSessions

    render(<MainLayout app={app} />)

    expect(await screen.findByText('db-1')).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveAttribute('data-state', 'reconnecting')
  })
})
