import { useCallback, useState, type ReactNode } from 'react'
import { CoreError, parseFfiError, t, type ConnectCredential, type Host, type Store } from '@termif/core'
import { logToFile } from './log.js'
import { HostKeyPrompt } from '../views/HostKeyPrompt.js'
import type { App } from './boot.js'
import type { HostStore } from './hostStore.js'

/** Reads a host's credential. The secret is returned verbatim from the store. */
export async function resolveCredential(
  store: Store,
  host: Host,
): Promise<ConnectCredential | null> {
  if (host.authRef === null) return null

  const credential = await store.getCredential(host.authRef)
  if (credential === null) {
    throw new CoreError(
      'credential_missing',
      'the credential this host points at no longer exists',
    )
  }

  return credential.kind === 'password'
    ? { password: credential.secret }
    : {
        privateKeyPem: credential.secret,
        ...(credential.passphrase === null ? {} : { passphrase: credential.passphrase }),
      }
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
  const core = parseFfiError(error)

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
      logToFile('info', 'connect', `attempt ${host.label} ${host.username}@${host.hostname}:${host.port}`)
      const credential = await resolveCredential(app.store, host)
      if (credential === null) {
        // No stored credential: the host form is where one gets added, so say
        // so rather than opening a second password prompt here.
        logToFile('warn', 'connect', `no credential for ${host.id}`)
        setLastError(t('connect.noCredential'))
        return
      }

      try {
        const sessionId = await app.sessions.connect(host, credential)
        logToFile('info', 'connect', `connected ${host.id} -> ${sessionId}`)
        const tabId = await app.sessions.openTab(sessionId, 80, 24)
        app.tabs.add({ id: tabId, sessionId, title: host.label })
        logToFile('info', 'connect', `tab ${tabId} opened`)
      } catch (e) {
        logToFile('error', 'connect', `connect failed ${host.id}: ${String(e)}`)
        throw e
      }
    },
    [app],
  )

  const start = useCallback(
    async (hostId: string): Promise<void> => {
      setLastError(null)
      const host = hostStore.get().hosts.find((h) => h.id === hostId)
      if (host === undefined) {
        logToFile('warn', 'connect', `start: host ${hostId} not found`)
        return
      }
      logToFile('info', 'connect', `start ${hostId}`)

      try {
        await attempt(host)
      } catch (error) {
        const failure = classifyConnectError(error)
        logToFile('error', 'connect', `start failed ${hostId}: ${String(error)} -> ${failure.kind}`)
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
