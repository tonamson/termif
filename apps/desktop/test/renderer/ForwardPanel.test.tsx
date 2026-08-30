import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t, type ForwardView } from '@termif/core'
import { ForwardPanelView } from '../../src/renderer/views/ForwardPanel.js'

const forward = (over: Partial<ForwardView> = {}): ForwardView => ({
  id: 'f1',
  kind: 'local',
  description: 'Forwarding 127.0.0.1:5432 to db.internal:5432',
  boundPort: 5432,
  acceptedCount: 0,
  lastPeer: null,
  note: null,
  ...over,
})

const props = {
  forwards: [forward()],
  connected: true,
  onOpenLocal: vi.fn(async () => {}),
  onOpenRemote: vi.fn(async () => {}),
  onOpenSocks: vi.fn(async () => {}),
  onClose: vi.fn(async () => {}),
}

describe('ForwardPanelView', () => {
  it('lists a forward with its description and bound port', () => {
    render(<ForwardPanelView {...props} />)
    expect(screen.getByText(/db.internal:5432/)).toBeInTheDocument()
    expect(screen.getByText(/port 5432/)).toBeInTheDocument()
  })

  it('shows the accepted-connection count once there is one', () => {
    render(<ForwardPanelView {...props} forwards={[forward({ acceptedCount: 3, lastPeer: '127.0.0.1:40001' })]} />)
    expect(screen.getByText(/3 connections/)).toBeInTheDocument()
    expect(screen.getByText(/127.0.0.1:40001/)).toBeInTheDocument()
  })

  it('shows the platform note when core supplies one', () => {
    // No v1 platform sets a note, but ForwardView carries the field (spec §5)
    // and the panel must render it rather than silently dropping it. The
    // desktop panel renders whatever note core attached.
    render(
      <ForwardPanelView {...props} forwards={[forward({ note: t('forward.iosForegroundOnly') })]} />,
    )
    expect(screen.getByText(t('forward.iosForegroundOnly'))).toBeInTheDocument()
  })

  it('opens a local forward from the form', async () => {
    const onOpenLocal = vi.fn(async () => {})
    render(<ForwardPanelView {...props} onOpenLocal={onOpenLocal} />)

    await userEvent.type(screen.getByLabelText(/local bind/i), '127.0.0.1:15432')
    await userEvent.type(screen.getByLabelText(/remote host/i), 'db.internal')
    await userEvent.clear(screen.getByLabelText(/remote port/i))
    await userEvent.type(screen.getByLabelText(/remote port/i), '5432')
    await userEvent.click(screen.getByRole('button', { name: /open forward/i }))

    expect(onOpenLocal).toHaveBeenCalledWith('127.0.0.1:15432', 'db.internal', 5432)
  })

  it('switches the form fields for a SOCKS forward', async () => {
    render(<ForwardPanelView {...props} />)

    await userEvent.selectOptions(screen.getByLabelText(/forward type/i), 'socks')

    expect(screen.getByLabelText(/local bind/i)).toBeInTheDocument()
    // SOCKS has no single remote target, so those fields must not be asked for.
    expect(screen.queryByLabelText(/remote host/i)).toBeNull()
  })

  it('opens a SOCKS forward with only a bind address', async () => {
    const onOpenSocks = vi.fn(async () => {})
    render(<ForwardPanelView {...props} onOpenSocks={onOpenSocks} />)

    await userEvent.selectOptions(screen.getByLabelText(/forward type/i), 'socks')
    await userEvent.type(screen.getByLabelText(/local bind/i), '127.0.0.1:1080')
    await userEvent.click(screen.getByRole('button', { name: /open forward/i }))

    expect(onOpenSocks).toHaveBeenCalledWith('127.0.0.1:1080')
  })

  it('opens a remote forward with both sides', async () => {
    const onOpenRemote = vi.fn(async () => {})
    render(<ForwardPanelView {...props} onOpenRemote={onOpenRemote} />)

    await userEvent.selectOptions(screen.getByLabelText(/forward type/i), 'remote')
    await userEvent.type(screen.getByLabelText(/remote bind host/i), '0.0.0.0')
    await userEvent.clear(screen.getByLabelText(/remote bind port/i))
    await userEvent.type(screen.getByLabelText(/remote bind port/i), '8080')
    await userEvent.type(screen.getByLabelText(/local host/i), '127.0.0.1')
    await userEvent.clear(screen.getByLabelText(/local port/i))
    await userEvent.type(screen.getByLabelText(/local port/i), '3000')
    await userEvent.click(screen.getByRole('button', { name: /open forward/i }))

    expect(onOpenRemote).toHaveBeenCalledWith('0.0.0.0', 8080, '127.0.0.1', 3000)
  })

  it('closes a forward', async () => {
    const onClose = vi.fn(async () => {})
    render(<ForwardPanelView {...props} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close forward/i }))
    expect(onClose).toHaveBeenCalledWith('f1')
  })

  it('disables the form with no connection', () => {
    render(<ForwardPanelView {...props} connected={false} forwards={[]} />)
    expect(screen.getByRole('button', { name: /open forward/i })).toBeDisabled()
    expect(screen.getByText(/connect to a host/i)).toBeInTheDocument()
  })
})
