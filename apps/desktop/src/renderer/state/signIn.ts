import type { DeviceFlowPoll, DeviceFlowStart } from '../../shared/ipc.js'

export type DeviceFlowPhase =
  | { kind: 'idle' }
  | { kind: 'code'; userCode: string; verificationUrl: string }
  | { kind: 'authorized' }
  | { kind: 'denied'; reason: string }
  | { kind: 'expired' }

export interface DeviceFlowAuth {
  hasSession(): Promise<boolean>
  startDeviceFlow(): Promise<DeviceFlowStart>
  pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll>
}

export interface DeviceFlowOpts {
  onPhase(phase: DeviceFlowPhase): void
  openExternal(url: string): Promise<void>
  sleep(ms: number): Promise<void>
  signal: { cancelled: boolean }
}

export interface SheetLookup {
  findSpreadsheetByTitle(title: string): Promise<string | null>
  createSpreadsheet(title: string): Promise<string>
}

export async function runDeviceFlow(
  auth: DeviceFlowAuth,
  opts: DeviceFlowOpts,
): Promise<'authorized' | 'denied' | 'expired' | 'cancelled'> {
  if (await auth.hasSession()) {
    opts.onPhase({ kind: 'authorized' })
    return 'authorized'
  }

  const started = await auth.startDeviceFlow()
  opts.onPhase({
    kind: 'code',
    userCode: started.userCode,
    verificationUrl: started.verificationUrl,
  })
  await opts.openExternal(started.verificationUrl)

  while (!opts.signal.cancelled) {
    await opts.sleep(started.intervalSecs * 1000)
    if (opts.signal.cancelled) return 'cancelled'

    const poll = await auth.pollDeviceFlow(started.deviceCode)
    if (poll.state === 'pending') continue
    if (poll.state === 'authorized') {
      opts.onPhase({ kind: 'authorized' })
      return 'authorized'
    }
    if (poll.state === 'denied') {
      opts.onPhase({ kind: 'denied', reason: poll.reason })
      return 'denied'
    }
    opts.onPhase({ kind: 'expired' })
    return 'expired'
  }

  return 'cancelled'
}

/**
 * Second desktop must attach the first desktop's sheet (spec §4). Creating
 * unconditionally would fork the ciphertext into two vaults.
 */
export async function connectSheet(
  setSpreadsheet: (id: string) => void,
  sheets: SheetLookup,
): Promise<string> {
  const existing = await sheets.findSpreadsheetByTitle('Termif')
  const id = existing ?? (await sheets.createSpreadsheet('Termif'))
  setSpreadsheet(id)
  return id
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
