import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Host } from '@termif/core'
import { HostList } from '../../src/renderer/views/HostList.js'

const host = (label: string, groupId: string | null, extra: Partial<Host> = {}): Host => ({
  id: label,
  label,
  hostname: `${label}.example.com`,
  port: 22,
  username: 'deploy',
  authRef: null,
  tags: [],
  groupId,
  updatedAt: '2026-08-30T00:00:00.000Z',
  deleted: false,
  ...extra,
})

const props = {
  query: '',
  collapsedGroups: [] as string[],
  connectedIds: [] as string[],
  onQueryChange: vi.fn(),
  onToggleGroup: vi.fn(),
  onConnect: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onAdd: vi.fn(),
}

describe('HostList grouped', () => {
  it('renders a heading per group', () => {
    render(<HostList {...props} hosts={[host('a', 'Production'), host('b', 'Staging')]} />)
    expect(screen.getByRole('button', { name: /production/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /staging/i })).toBeInTheDocument()
  })

  it('hides the hosts of a collapsed group', () => {
    render(
      <HostList
        {...props}
        hosts={[host('a', 'Production'), host('b', 'Staging')]}
        collapsedGroups={['Production']}
      />,
    )
    expect(screen.queryByText('a')).not.toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('shows the target line as user@hostname', () => {
    render(<HostList {...props} hosts={[host('a', null)]} />)
    expect(screen.getByText('deploy@a.example.com')).toBeInTheDocument()
  })

  it('appends the port only when it is not 22', () => {
    render(<HostList {...props} hosts={[host('a', null, { port: 2222 })]} />)
    expect(screen.getByText('deploy@a.example.com:2222')).toBeInTheDocument()
  })

  it('flattens groups while a search is active', () => {
    render(
      <HostList
        {...props}
        hosts={[host('alpha', 'Production')]}
        collapsedGroups={['Production']}
        query="alp"
      />,
    )
    expect(screen.queryByRole('button', { name: /production/i })).not.toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
  })

  it('marks a connected host', () => {
    render(<HostList {...props} hosts={[host('a', null)]} connectedIds={['a']} />)
    expect(screen.getByRole('listitem')).toHaveAttribute('data-state', 'connected')
  })

  it('toggles a group when its heading is clicked', async () => {
    const onToggleGroup = vi.fn()
    render(<HostList {...props} onToggleGroup={onToggleGroup} hosts={[host('a', 'Production')]} />)
    await userEvent.click(screen.getByRole('button', { name: /production/i }))
    expect(onToggleGroup).toHaveBeenCalledWith('Production')
  })
})
