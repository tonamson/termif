import { describe, expect, it, vi } from 'vitest'
import {
  connectSheet,
  runDeviceFlow,
  type DeviceFlowAuth,
} from '../../src/renderer/state/signIn.js'
import type { DeviceFlowPoll, DeviceFlowStart } from '../../src/shared/ipc.js'

function start(overrides: Partial<DeviceFlowStart> = {}): DeviceFlowStart {
  return {
    userCode: 'ABCD-EFGH',
    verificationUrl: 'https://google.com/device',
    deviceCode: 'dev-1',
    intervalSecs: 0,
    expiresInSecs: 1800,
    ...overrides,
  }
}

function auth(overrides: Partial<DeviceFlowAuth>): DeviceFlowAuth {
  return {
    hasSession: async () => false,
    startDeviceFlow: async () => start(),
    pollDeviceFlow: async () => ({ state: 'pending' }),
    ...overrides,
  }
}

describe('runDeviceFlow', () => {
  it('skips the device flow when a refresh token already exists', async () => {
    const startDeviceFlow = vi.fn()
    const result = await runDeviceFlow(auth({ hasSession: async () => true, startDeviceFlow }), {
      onPhase: vi.fn(),
      openExternal: vi.fn(),
      sleep: vi.fn(),
      signal: { cancelled: false },
    })
    expect(result).toBe('authorized')
    expect(startDeviceFlow).not.toHaveBeenCalled()
  })

  it('opens the verification URL and returns authorized after a pending poll', async () => {
    const polls: DeviceFlowPoll[] = [{ state: 'pending' }, { state: 'authorized' }]
    const openExternal = vi.fn()
    const phases: string[] = []

    const result = await runDeviceFlow(
      auth({
        pollDeviceFlow: async () => polls.shift() ?? { state: 'authorized' },
      }),
      {
        onPhase: (phase) => phases.push(phase.kind),
        openExternal,
        sleep: async () => {},
        signal: { cancelled: false },
      },
    )

    expect(result).toBe('authorized')
    expect(openExternal).toHaveBeenCalledWith('https://google.com/device')
    expect(phases).toEqual(['code', 'authorized'])
  })

  it('surfaces denial with the reason', async () => {
    const result = await runDeviceFlow(
      auth({
        pollDeviceFlow: async () => ({ state: 'denied', reason: 'access_denied' }),
      }),
      {
        onPhase: vi.fn(),
        openExternal: vi.fn(),
        sleep: async () => {},
        signal: { cancelled: false },
      },
    )
    expect(result).toBe('denied')
  })

  it('surfaces expiry so the user can restart', async () => {
    const result = await runDeviceFlow(
      auth({ pollDeviceFlow: async () => ({ state: 'expired' }) }),
      {
        onPhase: vi.fn(),
        openExternal: vi.fn(),
        sleep: async () => {},
        signal: { cancelled: false },
      },
    )
    expect(result).toBe('expired')
  })

  it('stops polling when cancelled during the wait', async () => {
    const signal = { cancelled: false }
    const pollDeviceFlow = vi.fn()
    const pending = runDeviceFlow(auth({ pollDeviceFlow }), {
      onPhase: vi.fn(),
      openExternal: vi.fn(),
      sleep: async () => {
        signal.cancelled = true
      },
      signal,
    })
    expect(await pending).toBe('cancelled')
    expect(pollDeviceFlow).not.toHaveBeenCalled()
  })
})

describe('connectSheet', () => {
  it('reuses an existing Termif spreadsheet rather than creating a second vault', async () => {
    const setSpreadsheet = vi.fn()
    const create = vi.fn()
    const id = await connectSheet(setSpreadsheet, {
      findSpreadsheetByTitle: async () => 'existing-sheet',
      createSpreadsheet: create,
    })
    expect(id).toBe('existing-sheet')
    expect(setSpreadsheet).toHaveBeenCalledWith('existing-sheet')
    expect(create).not.toHaveBeenCalled()
  })

  it('creates the spreadsheet only when none exists', async () => {
    const setSpreadsheet = vi.fn()
    const id = await connectSheet(setSpreadsheet, {
      findSpreadsheetByTitle: async () => null,
      createSpreadsheet: async () => 'new-sheet',
    })
    expect(id).toBe('new-sheet')
    expect(setSpreadsheet).toHaveBeenCalledWith('new-sheet')
  })
})
