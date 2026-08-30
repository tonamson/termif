import { useEffect, useState } from 'react'
import { t, type Host, type StoredCredential } from '@termif/core'
import type { SaveHostInput, SecretInput } from '../state/hostStore.js'
import { inspectPrivateKey } from '../state/privateKey.js'

export interface InspectorProps {
  host: Host | null
  credential: StoredCredential | null
  groups: readonly string[]
  onSave(input: SaveHostInput, secret: SecretInput | null): Promise<void>
  onPickKeyFile(): Promise<string | null>
}

function fromHost(host: Host | null) {
  return {
    label: host?.label ?? '',
    hostname: host?.hostname ?? '',
    port: String(host?.port ?? 22),
    username: host?.username ?? '',
    groupId: host?.groupId ?? '',
    tags: (host?.tags ?? []).join(', '),
  }
}

function validate(draft: ReturnType<typeof fromHost>): string | null {
  if (draft.label.trim().length === 0) return t('form.error.label')
  if (draft.hostname.trim().length === 0) return t('form.error.hostname')
  if (draft.username.trim().length === 0) return t('form.error.username')
  const p = Number(draft.port)
  if (!Number.isInteger(p) || p < 1 || p > 65535) return t('form.error.port')
  return null
}

export function Inspector({ host, credential, groups, onSave, onPickKeyFile }: InspectorProps) {
  const [draft, setDraft] = useState(() => fromHost(host))
  const [error, setError] = useState<string | null>(null)
  const [authType, setAuthType] = useState<'password' | 'key'>('password')
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [keyInfo, setKeyInfo] = useState<string | null>(null)

  useEffect(() => setDraft(fromHost(host)), [host?.id])
  useEffect(() => {
    if (host === null) return
    const inputSecret: SecretInput | null =
      secret.length === 0
        ? null
        : {
            kind: authType,
            label: `${draft.label.trim()} ${authType}`,
            secret,
            passphrase: authType === 'key' && passphrase.length > 0 ? passphrase : null,
          }
    // Validate secret if key
    if (authType === 'key' && secret.length > 0) {
      void inspectPrivateKey(secret).then((r) => {
        if (!r.ok) setKeyInfo(r.reason)
        else setKeyInfo(`${r.type}${r.encrypted ? ' encrypted' : ''} ${r.fingerprint ?? ''}`)
      })
    }
    void undefined
    void inputSecret
  }, [authType, draft.label, passphrase, secret, host])

  useEffect(() => {
    if (host === null) return
    const problem = validate(draft)
    setError(problem)
    if (problem !== null) return
    const timer = setTimeout(() => {
      const input: SaveHostInput = {
        id: host.id,
        label: draft.label.trim(),
        hostname: draft.hostname.trim(),
        port: Number(draft.port),
        username: draft.username.trim(),
        tags: draft.tags
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        groupId: draft.groupId.trim().length === 0 ? null : draft.groupId.trim(),
        authRef: host.authRef,
      }
      const secretOf: SecretInput | null =
        secret.length === 0
          ? null
          : {
              kind: authType,
              label: `${input.label} ${authType}`,
              secret,
              passphrase: authType === 'key' && passphrase.length > 0 ? passphrase : null,
            }
      void onSave(input, secretOf)
    }, 400)
    return () => clearTimeout(timer)
  }, [draft, host, authType, secret, passphrase, onSave])

  if (host === null) {
    return <p className="inspector__empty">{t('host.empty')}</p>
  }

  return (
    <div className="inspector">
      <label>
        {t('form.label')}
        <input aria-label={t('form.label')} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
      </label>
      <label>
        {t('form.hostname')}
        <input aria-label={t('form.hostname')} value={draft.hostname} onChange={(e) => setDraft({ ...draft, hostname: e.target.value })} />
      </label>
      <label>
        {t('form.port')}
        <input aria-label={t('form.port')} value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value })} />
      </label>
      <label>
        {t('form.username')}
        <input aria-label={t('form.username')} value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
      </label>
      <label>
        {t('form.tags')}
        <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
      </label>
      <label>
        Group
        <input aria-label="Group" list="group-options" value={draft.groupId} onChange={(e) => setDraft({ ...draft, groupId: e.target.value })} />
        <datalist id="group-options" data-testid="group-options">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </label>

      <label>
        {t('form.authentication')}
        <select aria-label={t('form.authentication')} value={authType} onChange={(e) => setAuthType(e.target.value as 'password' | 'key')}>
          <option value="password">{t('form.password')}</option>
          <option value="key">{t('form.privateKey')}</option>
        </select>
      </label>

      {authType === 'password' ? (
        <label>
          {t('form.password')}
          <div style={{ display: 'flex', gap: 8 }}>
            <input aria-label={t('form.password')} type={showPw ? 'text' : 'password'} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={credential ? t('form.passwordPlaceholder') : ''} />
            <button type="button" onClick={() => setShowPw(!showPw)}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={async () => { const f = await onPickKeyFile(); if (f) setSecret(f) }}>
              Choose file
            </button>
            <button type="button" onClick={() => {}}>
              Paste
            </button>
          </div>
          <label>
            {t('form.privateKey')}
            <textarea aria-label={t('form.privateKey')} value={secret} onChange={(e) => setSecret(e.target.value)} rows={6} />
          </label>
          {keyInfo && <p>{keyInfo}</p>}
          <label>
            {t('form.keyPassphrase')}
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </label>
        </>
      )}

      {error && <p role="alert">{error}</p>}
    </div>
  )
}
