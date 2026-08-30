import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@termif/core'
import { UnlockScreen } from '../../src/renderer/views/UnlockScreen.js'

describe('UnlockScreen', () => {
  it('submits the typed password', async () => {
    const onUnlock = vi.fn(async () => {})
    render(<UnlockScreen error={null} onUnlock={onUnlock} onDeviceUnlock={null} />)

    await userEvent.type(screen.getByLabelText(t('vault.unlock.prompt')), 'my-password')
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }))

    expect(onUnlock).toHaveBeenCalledWith('my-password', false)
  })

  it('passes the remember choice through', async () => {
    const onUnlock = vi.fn(async () => {})
    render(<UnlockScreen error={null} onUnlock={onUnlock} onDeviceUnlock={null} />)

    await userEvent.type(screen.getByLabelText(t('vault.unlock.prompt')), 'pw')
    await userEvent.click(screen.getByLabelText(t('vault.remember')))
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }))

    expect(onUnlock).toHaveBeenCalledWith('pw', true)
  })

  it('shows the error message when unlocking failed', () => {
    render(
      <UnlockScreen error={t('vault.unlock.wrong')} onUnlock={vi.fn()} onDeviceUnlock={null} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(t('vault.unlock.wrong'))
  })

  it('does not submit an empty password', async () => {
    const onUnlock = vi.fn(async () => {})
    render(<UnlockScreen error={null} onUnlock={onUnlock} onDeviceUnlock={null} />)

    await userEvent.click(screen.getByRole('button', { name: /unlock/i }))

    expect(onUnlock).not.toHaveBeenCalled()
  })

  it('masks the password field', () => {
    render(<UnlockScreen error={null} onUnlock={vi.fn()} onDeviceUnlock={null} />)
    expect(screen.getByLabelText(t('vault.unlock.prompt'))).toHaveAttribute('type', 'password')
  })

  it('offers the device unlock only when one is available', async () => {
    const onDeviceUnlock = vi.fn(async () => true)
    const { rerender } = render(
      <UnlockScreen error={null} onUnlock={vi.fn()} onDeviceUnlock={onDeviceUnlock} />,
    )

    const button = screen.getByRole('button', { name: /this device/i })
    await userEvent.click(button)
    expect(onDeviceUnlock).toHaveBeenCalled()

    rerender(<UnlockScreen error={null} onUnlock={vi.fn()} onDeviceUnlock={null} />)
    expect(screen.queryByRole('button', { name: /this device/i })).toBeNull()
  })
})
