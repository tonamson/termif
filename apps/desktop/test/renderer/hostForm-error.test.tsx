import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HostForm } from '../../src/renderer/views/HostForm.js'

describe('HostForm error handling', () => {
  it('shows an error when onSave throws', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('store failed: no such column: passphrase')
    })
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'web-1')
    await userEvent.type(screen.getByLabelText(/hostname/i), 'h.example.com')
    await userEvent.type(screen.getByLabelText(/username/i), 'deploy')
    // leave tags empty, no secret
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    // Must show the error, not silently stay
    expect(await screen.findByRole('alert')).toHaveTextContent(/store failed/i)
  })
})
