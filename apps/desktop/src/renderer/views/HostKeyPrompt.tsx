import { t } from '@termif/core'

export interface HostKeyPromptProps {
  mode: 'unknown' | 'mismatch'
  host: string
  algo: string
  fingerprint: string
  /** The previously trusted fingerprint; only set for a mismatch. */
  expected: string | null
  onTrust(): void
  onCancel(): void
}

export function HostKeyPrompt({
  mode,
  host,
  algo,
  fingerprint,
  expected,
  onTrust,
  onCancel,
}: HostKeyPromptProps) {
  if (mode === 'mismatch') {
    return (
      <div role="alertdialog" aria-labelledby="hostkey-title" className="hostkey hostkey--mismatch">
        <h2 id="hostkey-title">{t('hostkey.mismatch.title', { host })}</h2>
        <p>
          {t('hostkey.mismatch.body', {
            expected: expected ?? 'unknown',
            got: fingerprint,
          })}
        </p>

        {/*
          Exactly one button. No "trust anyway", no "just this once": a changed
          host key is how an interception looks from the inside, and an escape
          hatch here would be the one the user reaches for under time pressure
          (spec §7).
        */}
        <button type="button" onClick={onCancel} autoFocus>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div role="alertdialog" aria-labelledby="hostkey-title" className="hostkey hostkey--unknown">
      <h2 id="hostkey-title">{t('hostkey.unknown.title', { host })}</h2>
      <p>{t('hostkey.unknown.body', { algo, fingerprint })}</p>

      <div className="hostkey__actions">
        <button type="button" onClick={onTrust} autoFocus>
          {t('hostkey.unknown.trust')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('hostkey.unknown.cancel')}
        </button>
      </div>
    </div>
  )
}
