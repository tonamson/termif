import { useEffect, useRef, useState } from 'react'
import { SheetClient, t } from '@termif/core'
import type { App } from '../state/boot.js'
import {
  connectSheet,
  defaultSleep,
  runDeviceFlow,
  type DeviceFlowPhase,
} from '../state/signIn.js'

export interface SignInScreenViewProps {
  phase: DeviceFlowPhase
  busy: boolean
  onStart(): void
  onCancel(): void
}

export function SignInScreenView({ phase, busy, onStart, onCancel }: SignInScreenViewProps) {
  const error =
    phase.kind === 'denied'
      ? t('sync.signIn.denied', { reason: phase.reason })
      : phase.kind === 'expired'
        ? t('sync.signIn.expired')
        : null

  return (
    <section className="sign-in">
      <h2>{t('sync.signIn')}</h2>
      <p>{t('sync.signIn.body')}</p>

      {phase.kind === 'code' && (
        <>
          <p>
            {t('sync.signIn.code', { code: phase.userCode })}
          </p>
          <p>{t('sync.signIn.open')}</p>
          {busy && <p role="status">{t('sync.signIn.waiting')}</p>}
        </>
      )}

      {error !== null && <p role="alert">{error}</p>}

      <div className="sign-in__actions">
        {(phase.kind === 'idle' || phase.kind === 'denied' || phase.kind === 'expired') && (
          <button type="button" disabled={busy} onClick={onStart}>
            {t('sync.signIn.start')}
          </button>
        )}
        <button type="button" onClick={onCancel}>
          {t('sync.signIn.cancel')}
        </button>
      </div>
    </section>
  )
}

export function SignInScreen({ app, onDone, onCancel }: { app: App; onDone(): void; onCancel(): void }) {
  const [phase, setPhase] = useState<DeviceFlowPhase>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const signal = useRef({ cancelled: false })

  useEffect(() => {
    const live = signal.current
    return () => {
      live.cancelled = true
    }
  }, [])

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await runDeviceFlow(window.termif.auth, {
        onPhase: setPhase,
        openExternal: (url) => window.termif.app.openExternal(url),
        sleep: defaultSleep,
        signal: signal.current,
      })
      if (result !== 'authorized') return

      const client = new SheetClient(app.platform.net, () => window.termif.auth.accessToken())
      await connectSheet((id) => app.setSpreadsheet(id), client)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <SignInScreenView
      phase={phase}
      busy={busy}
      onStart={() => void start()}
      onCancel={onCancel}
    />
  )
}
