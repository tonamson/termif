import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@termif/core'
import { HostKeyPrompt } from '../../src/renderer/views/HostKeyPrompt.js'

describe('HostKeyPrompt', () => {
  it('shows the fingerprint and algorithm for an unknown key', () => {
    render(
      <HostKeyPrompt
        mode="unknown"
        host="web1.example.com"
        algo="ssh-ed25519"
        fingerprint="SHA256:aaa"
        expected={null}
        onTrust={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(t('hostkey.unknown.title', { host: 'web1.example.com' }))).toBeInTheDocument()
    expect(screen.getByText(/SHA256:aaa/)).toBeInTheDocument()
    expect(screen.getByText(/ssh-ed25519/)).toBeInTheDocument()
  })

  it('trusts on confirmation', async () => {
    const onTrust = vi.fn()
    render(
      <HostKeyPrompt
        mode="unknown"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:aaa"
        expected={null}
        onTrust={onTrust}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: t('hostkey.unknown.trust') }))
    expect(onTrust).toHaveBeenCalled()
  })

  it('cancels without trusting', async () => {
    const onTrust = vi.fn()
    const onCancel = vi.fn()
    render(
      <HostKeyPrompt
        mode="unknown"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:aaa"
        expected={null}
        onTrust={onTrust}
        onCancel={onCancel}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: t('hostkey.unknown.cancel') }))
    expect(onCancel).toHaveBeenCalled()
    expect(onTrust).not.toHaveBeenCalled()
  })

  it('shows both fingerprints on a mismatch', () => {
    render(
      <HostKeyPrompt
        mode="mismatch"
        host="web1.example.com"
        algo="ssh-ed25519"
        fingerprint="SHA256:bbb"
        expected="SHA256:aaa"
        onTrust={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/SHA256:aaa/)).toBeInTheDocument()
    expect(screen.getByText(/SHA256:bbb/)).toBeInTheDocument()
  })

  it('offers no way to continue past a mismatch', () => {
    // The spec makes this a hard block: a changed key is the signature of an
    // MITM in progress, so the UI must not render an override at all.
    render(
      <HostKeyPrompt
        mode="mismatch"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:bbb"
        expected="SHA256:aaa"
        onTrust={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName(/cancel|close/i)
    expect(screen.queryByRole('button', { name: /trust|continue|proceed|anyway|once/i })).toBeNull()
  })

  it('calling onTrust is impossible in mismatch mode even programmatically via the UI', async () => {
    const onTrust = vi.fn()
    render(
      <HostKeyPrompt
        mode="mismatch"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:bbb"
        expected="SHA256:aaa"
        onTrust={onTrust}
        onCancel={vi.fn()}
      />,
    )

    for (const button of screen.getAllByRole('button')) {
      await userEvent.click(button)
    }
    expect(onTrust).not.toHaveBeenCalled()
  })

  it('is announced as an alert dialog, so it is not missed', () => {
    render(
      <HostKeyPrompt
        mode="mismatch"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:bbb"
        expected="SHA256:aaa"
        onTrust={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
