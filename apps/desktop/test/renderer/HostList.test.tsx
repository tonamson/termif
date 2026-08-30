import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Host } from '@termif/core'
import { HostList } from '../../src/renderer/views/HostList.js'

const host = (over: Partial<Host> = {}): Host => ({
  id: 'h1',
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  authRef: null,
  tags: ['prod'],
  groupId: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
  ...over,
})

describe('HostList', () => {
  it('renders each host with its user and hostname', () => {
    render(
      <HostList
        hosts={[host(), host({ id: 'h2', label: 'db-1', hostname: 'db.internal' })]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    expect(screen.getByText('web-1')).toBeInTheDocument()
    expect(screen.getByText('deploy@web1.example.com')).toBeInTheDocument()
    expect(screen.getByText('db-1')).toBeInTheDocument()
  })

  it('shows the port only when it is not 22, so the common case stays quiet', () => {
    const { rerender } = render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.queryByText(/:22\b/)).toBeNull()

    rerender(
      <HostList
        hosts={[host({ port: 2222 })]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.getByText(/:2222/)).toBeInTheDocument()
  })

  it('connects on a double click, which is the fast path', async () => {
    const onConnect = vi.fn()
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={onConnect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    await userEvent.dblClick(screen.getByRole('listitem'))

    expect(onConnect).toHaveBeenCalledWith('h1')
  })

  it('connects on Enter for keyboard users', async () => {
    const onConnect = vi.fn()
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={onConnect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    screen.getByRole('listitem').focus()
    await userEvent.keyboard('{Enter}')

    expect(onConnect).toHaveBeenCalledWith('h1')
  })

  it('reports search input upward rather than filtering itself', async () => {
    const onQueryChange = vi.fn()
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={onQueryChange}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    await userEvent.type(screen.getByRole('searchbox'), 'db')

    expect(onQueryChange).toHaveBeenLastCalledWith('db')
  })

  it('asks for confirmation before deleting', async () => {
    const onDelete = vi.fn()
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onAdd={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /delete web-1/i }))
    expect(onDelete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^confirm/i }))
    expect(onDelete).toHaveBeenCalledWith('h1')
  })

  it('shows an empty state that differs for no hosts versus no matches', () => {
    const { rerender } = render(
      <HostList
        hosts={[]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.getByText(/no hosts yet/i)).toBeInTheDocument()

    rerender(
      <HostList
        hosts={[]}
        query="zzz"
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.getByText(/no hosts match/i)).toBeInTheDocument()
  })

  it('keeps row actions in the DOM so they stay keyboard-reachable', () => {
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    // The actions are hidden with opacity, never display:none — a row's buttons
    // must remain focusable by Tab even before the pointer arrives.
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit web-1/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete web-1/i })).toBeInTheDocument()
  })
})
