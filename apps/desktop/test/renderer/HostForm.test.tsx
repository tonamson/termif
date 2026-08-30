import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HostForm } from '../../src/renderer/views/HostForm.js'

describe('HostForm', () => {
  it('defaults the port to 22', () => {
    render(<HostForm host={null} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/port/i)).toHaveValue(22)
  })

  it('submits label, hostname, port, username, and tags', async () => {
    const onSave = vi.fn(async () => {})
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'web-1')
    await userEvent.type(screen.getByLabelText(/hostname/i), 'web1.example.com')
    await userEvent.clear(screen.getByLabelText(/port/i))
    await userEvent.type(screen.getByLabelText(/port/i), '2222')
    await userEvent.type(screen.getByLabelText(/username/i), 'deploy')
    await userEvent.type(screen.getByLabelText(/tags/i), 'prod, eu')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'web-1',
        hostname: 'web1.example.com',
        port: 2222,
        username: 'deploy',
        tags: ['prod', 'eu'],
      }),
      null,
    )
  })

  it('submits a password credential when one is entered', async () => {
    const onSave = vi.fn(async () => {})
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'web-1')
    await userEvent.type(screen.getByLabelText(/hostname/i), 'h')
    await userEvent.type(screen.getByLabelText(/username/i), 'u')
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'password', secret: 'hunter2' }),
    )
  })

  it('switches to a key field when the key auth type is chosen', async () => {
    render(<HostForm host={null} onSave={vi.fn()} onCancel={vi.fn()} />)

    await userEvent.selectOptions(screen.getByLabelText(/authentication/i), 'key')

    expect(screen.getByLabelText(/private key/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^password/i)).toBeNull()
  })

  it('will not submit without a hostname', async () => {
    const onSave = vi.fn(async () => {})
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'web-1')
    await userEvent.type(screen.getByLabelText(/username/i), 'u')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('rejects a port outside 1-65535', async () => {
    const onSave = vi.fn(async () => {})
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'x')
    await userEvent.type(screen.getByLabelText(/hostname/i), 'h')
    await userEvent.type(screen.getByLabelText(/username/i), 'u')
    await userEvent.clear(screen.getByLabelText(/port/i))
    await userEvent.type(screen.getByLabelText(/port/i), '70000')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('prefills from an existing host and keeps its id', async () => {
    const onSave = vi.fn(async () => {})
    render(
      <HostForm
        host={{
          id: 'h1',
          label: 'web-1',
          hostname: 'web1.example.com',
          port: 2222,
          username: 'deploy',
          authRef: 'c1',
          tags: ['prod'],
          groupId: null,
          updatedAt: '2026-08-28T10:00:00.000Z',
          deleted: false,
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/^label/i)).toHaveValue('web-1')
    expect(screen.getByLabelText(/port/i)).toHaveValue(2222)
    expect(screen.getByLabelText(/tags/i)).toHaveValue('prod')

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'h1', authRef: 'c1' }),
      // No new secret typed, so the existing credential is left alone.
      null,
    )
  })

  it('cancels without saving', async () => {
    const onCancel = vi.fn()
    render(<HostForm host={null} onSave={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
