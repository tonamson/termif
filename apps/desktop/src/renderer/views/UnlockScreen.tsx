import { useState, type FormEvent } from 'react'
import { t } from '@termif/core'

export interface UnlockScreenProps {
  error: string | null
  onUnlock(password: string, remember: boolean): Promise<void>
  /** Null when this device has no remembered key. */
  onDeviceUnlock: (() => Promise<boolean>) | null
}

export function UnlockScreen({ error, onUnlock, onDeviceUnlock }: UnlockScreenProps) {
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (password.length === 0 || busy) return

    setBusy(true)
    try {
      await onUnlock(password, remember)
    } finally {
      setBusy(false)
      // Clear it either way: a failed attempt should not leave the secret in
      // a DOM node.
      setPassword('')
    }
  }

  return (
    <main className="unlock">
      <h1>{t('vault.locked')}</h1>

      <form onSubmit={submit}>
        <label htmlFor="master-password">{t('vault.unlock.prompt')}</label>
        <input
          id="master-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label htmlFor="remember-device">
          <input
            id="remember-device"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('vault.remember')}
        </label>

        {error !== null && <p role="alert">{error}</p>}

        <button type="submit" disabled={busy}>
          {t('vault.unlock.submit')}
        </button>
      </form>

      {onDeviceUnlock !== null && (
        <button type="button" onClick={() => void onDeviceUnlock()}>
          {t('vault.unlock.device')}
        </button>
      )}
    </main>
  )
}
