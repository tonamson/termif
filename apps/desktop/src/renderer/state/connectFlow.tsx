import { useCallback, useState, type ReactNode } from 'react'
import {
  CoreError,
  t,
  type ConnectCredential,
  type Host,
  type Store,
  type Vault,
} from '@termif/core'
import { HostKeyPrompt } from '../views/HostKeyPrompt.js'
import type { App } from './boot.js'
import type { HostStore } from './hostStore.js'

/**
 * Reads a host's credential and decrypts it. The plaintext exists only for the
 * duration of the connect call and is never written anywhere (spec §3).
 */
export async function resolveCredential(
  store: Store,
  vault: Vault | null,
  host: Host,
): Promise<ConnectCredential | null> {
  if (host.authRef === null) return null

  if (vault === null) {
    throw new CoreError('vault_locked', 'unlock the vault to use this host’s credential')
  }

  const credential = await store.getCredential(host.authRef)
  if (credential === null) {
    throw new CoreError(
      'credential_missing',
      'the credential this host points at is no longer in the vault',
    )
  }

  const secret = vault.decrypt(credential.cipher, credential.id)
  return credential.kind === 'password' ? { password: secret } : { privateKeyPem: secret }
}

export type ConnectFailure =
  | {
      kind: 'prompt'
      mode: 'unknown' | 'mismatch'
      fingerprint: string
      algo: string
      expected: string | null
    }
  | { kind: 'message'; text: string }

export function classifyConnectError(error: unknown): ConnectFailure {
  const core = error instanceof CoreError ? error : new CoreError('unknown', String(error))

  if (core.code === 'host_key_unknown') {
    return {
      kind: 'prompt',
      mode: 'unknown',
      fingerprint: core.details.fingerprint ?? '',
      algo: core.details.algo ?? '',
      expected: null,
    }
  }

  if (core.code === 'host_key_mismatch') {
    return {
      kind: 'prompt',
      mode: 'mismatch',
      fingerprint: core.details.got ?? '',
      algo: '',
      expected: core.details.expected ?? null,
    }
  }

  switch (core.code) {
    case 'auth':
      return { kind: 'message', text: t('error.auth.failed') }
    case 'timeout':
      return { kind: 'message', text: t('error.connect.timeout', { host: core.details.host ?? '' }) }
    case 'connect':
      return { kind: 'message', text: t('error.connect.refused', { host: core.details.host ?? '' }) }
    default:
      return { kind: 'message', text: t('error.unknown', { reason: core.message }) }
  }
}

interface PromptState {
  host: Host
  mode: 'unknown' | 'mismatch'
  fingerprint: string
  algo: string
  expected: string | null
}

export interface ConnectFlow {
  start(hostId: string): Promise<void>
  prompt: ReactNode
  lastError: string | null
}

/**
 * Drives connect, including the one legitimate retry: after the user trusts a
 * previously unknown key. A mismatch never retries.
 */
export function useConnectFlow(app: App, hostStore: HostStore): ConnectFlow {
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const attempt = useCallback(
    async (host: Host): Promise<void> => {
      const credential = await resolveCredential(app.store, app.vaultStore.vault(), host)
      if (credential === null) {
        // No stored credential: the host form is where one gets added, so say
        // so rather than opening a second password prompt here.
        setLastError(t('connect.noCredential'))
        return
      }

      const sessionId = await app.sessions.connect(host, credential)
      await app.sessions.openTab(sessionId, 80, 24)
    },
    [app],
  )

  const start = useCallback(
    async (hostId: string): Promise<void> => {
      setLastError(null)
      const host = hostStore.get().hosts.find((h) => h.id === hostId)
      if (host === undefined) return

      try {
        await attempt(host)
      } catch (error) {
        const failure = classifyConnectError(error)
        if (failure.kind === 'message') {
          setLastError(failure.text)
          return
        }
        setPrompt({
          host,
          mode: failure.mode,
          fingerprint: failure.fingerprint,
          algo: failure.algo,
          expected: failure.expected,
        })
      }
    },
    [attempt, hostStore],
  )

  const trustAndRetry = useCallback(async (): Promise<void> => {
    if (prompt === null || prompt.mode !== 'unknown') return
    const { host, algo, fingerprint } = prompt
    setPrompt(null)

    try {
      await app.platform.ssh.trustHostKey(host.hostname, host.port, algo, fingerprint)
      await attempt(host)
    } catch (error) {
      const failure = classifyConnectError(error)
      // Exactly one retry: if it still fails, report rather than loop.
      setLastError(failure.kind === 'message' ? failure.text : t('error.unknown', { reason: '' }))
    }
  }, [app, attempt, prompt])

  return {
    start,
    lastError,
    prompt:
      prompt === null ? null : (
        <HostKeyPrompt
          mode={prompt.mode}
          host={prompt.host.hostname}
          algo={prompt.algo}
          fingerprint={prompt.fingerprint}
          expected={prompt.expected}
          onTrust={() => void trustAndRetry()}
          onCancel={() => setPrompt(null)}
        />
      ),
  }
}
