import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppRoot } from '../../src/renderer/app/AppRoot.js'
import { bootApp } from '../../src/renderer/state/boot.js'
import { fakePlatform } from './fakes/platform.js'

describe('AppRoot local-only', () => {
  it('shows the host list on an empty database with no password field', async () => {
    const platform = await fakePlatform()
    const app = await bootApp(platform)

    render(<AppRoot app={app} />)

    // Host list is the main view - empty state text
    expect(await screen.findByText(/no hosts yet/i)).toBeInTheDocument()
    // Old flow stuck on setup/unlock screen which has a password input
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/type="password"/i)
  })
})
