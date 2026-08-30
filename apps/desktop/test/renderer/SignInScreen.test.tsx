import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SignInScreenView } from '../../src/renderer/views/SignInScreen.js'

describe('SignInScreenView', () => {
  it('shows the user code and does not offer an override', () => {
    render(
      <SignInScreenView
        phase={{ kind: 'code', userCode: 'ABCD-EFGH', verificationUrl: 'https://google.com/device' }}
        busy={false}
        onStart={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText(/ABCD-EFGH/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /continue anyway/i })).toBeNull()
  })

  it('starts the flow from the idle state', async () => {
    const onStart = vi.fn()
    render(
      <SignInScreenView phase={{ kind: 'idle' }} busy={false} onStart={onStart} onCancel={() => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('states a denial without closing the form', () => {
    render(
      <SignInScreenView
        phase={{ kind: 'denied', reason: 'access_denied' }}
        busy={false}
        onStart={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/access_denied/)
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeTruthy()
  })
})
