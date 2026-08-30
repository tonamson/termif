import { useState, type FormEvent } from 'react'
import { t } from '@termif/core'

export interface SetupScreenProps {
  onSetup(password: string, remember: boolean): Promise<void>
}

/** Minimum length is a floor, not a strength meter; Argon2id carries the rest. */
const MIN_LENGTH = 10

export function SetupScreen({ onSetup }: SetupScreenProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(true)

  const tooShort = password.length > 0 && password.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit = password.length >= MIN_LENGTH && password === confirm

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return
    await onSetup(password, remember)
    setPassword('')
    setConfirm('')
  }

  return (
    <main className="setup">
      <h1>{t('vault.setup.title')}</h1>
      {/* Says plainly that a lost password means lost credentials (spec §10). */}
      <p>{t('vault.setup.warning')}</p>

      <form onSubmit={submit}>
        <label htmlFor="new-password">{t('vault.unlock.prompt')}</label>
        <input
          id="new-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tooShort && <p role="alert">{t('vault.setup.tooShort', { N: MIN_LENGTH })}</p>}

        <label htmlFor="confirm-password">{t('vault.setup.confirm')}</label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <p role="alert">{t('vault.setup.mismatch')}</p>}

        <label htmlFor="remember-setup">
          <input
            id="remember-setup"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('vault.remember')}
        </label>

        <button type="submit" data-variant="primary" disabled={!canSubmit}>
          {t('vault.setup.create')}
        </button>
      </form>
    </main>
  )
}
