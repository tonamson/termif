import { useState, type FormEvent } from 'react'
import { t } from '@termif/core'
import type { Host, HostInput } from '@termif/core'
import type { SecretInput } from '../state/hostStore.js'

export interface HostFormProps {
  /** Null to add; a host to edit. */
  host: Host | null
  onSave(input: HostInput, secret: SecretInput | null): Promise<void>
  onCancel(): void
}

type AuthType = 'password' | 'key'

export function HostForm({ host, onSave, onCancel }: HostFormProps) {
  const [label, setLabel] = useState(host?.label ?? '')
  const [hostname, setHostname] = useState(host?.hostname ?? '')
  const [port, setPort] = useState(host?.port ?? 22)
  const [username, setUsername] = useState(host?.username ?? '')
  const [tags, setTags] = useState((host?.tags ?? []).join(', '))
  const [authType, setAuthType] = useState<AuthType>('password')
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    if (label.trim().length === 0) return setError(t('form.error.label'))
    if (hostname.trim().length === 0) return setError(t('form.error.hostname'))
    if (username.trim().length === 0) return setError(t('form.error.username'))
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return setError(t('form.error.port'))
    }
    setError(null)

    const input: HostInput = {
      ...(host === null ? {} : { id: host.id }),
      label: label.trim(),
      hostname: hostname.trim(),
      port,
      username: username.trim(),
      authRef: host?.authRef ?? null,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
      groupId: host?.groupId ?? null,
    }

    // An empty secret field on an edit means "leave the stored credential
    // alone", not "clear it".
    const secretInput: SecretInput | null =
      secret.length === 0
        ? null
        : {
            kind: authType,
            label: `${input.label} ${authType}`,
            secret: authType === 'key' && passphrase.length > 0 ? secret : secret,
          }

    await onSave(input, secretInput)
  }

  return (
    <form className="host-form" onSubmit={submit}>
      <h2>{host === null ? t('form.add') : t('form.edit', { label: host.label })}</h2>

      <label htmlFor="host-label">{t('form.label')}</label>
      <input id="host-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />

      <label htmlFor="host-hostname">{t('form.hostname')}</label>
      <input id="host-hostname" value={hostname} onChange={(e) => setHostname(e.target.value)} />

      <label htmlFor="host-port">{t('form.port')}</label>
      <input
        id="host-port"
        type="number"
        min={1}
        max={65535}
        value={port}
        onChange={(e) => setPort(Number(e.target.value))}
      />

      <label htmlFor="host-username">{t('form.username')}</label>
      <input id="host-username" value={username} onChange={(e) => setUsername(e.target.value)} />

      <label htmlFor="host-tags">{t('form.tags')}</label>
      <input
        id="host-tags"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder={t('form.tagsPlaceholder')}
      />

      <label htmlFor="host-auth">{t('form.authentication')}</label>
      <select
        id="host-auth"
        value={authType}
        onChange={(e) => setAuthType(e.target.value as AuthType)}
      >
        <option value="password">{t('form.password')}</option>
        <option value="key">{t('form.privateKey')}</option>
      </select>

      {authType === 'password' ? (
        <>
          <label htmlFor="host-password">{t('form.password')}</label>
          <input
            id="host-password"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={host?.authRef == null ? '' : t('form.passwordPlaceholder')}
          />
        </>
      ) : (
        <>
          <label htmlFor="host-key">{t('form.privateKey')}</label>
          <textarea
            id="host-key"
            rows={6}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={t('form.keyPlaceholder')}
          />

          <label htmlFor="host-passphrase">{t('form.keyPassphrase')}</label>
          <input
            id="host-passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </>
      )}

      {error !== null && <p role="alert">{error}</p>}

      <div className="host-form__actions">
        <button type="submit" data-variant="primary">{t('form.save')}</button>
        <button type="button" onClick={onCancel}>
          {t('form.cancel')}
        </button>
      </div>
    </form>
  )
}
