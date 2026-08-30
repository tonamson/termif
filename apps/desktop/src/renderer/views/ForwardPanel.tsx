import { useEffect, useState } from 'react'
import { t, type ForwardView } from '@termif/core'
import type { App } from '../state/boot.js'

type ForwardKind = 'local' | 'remote' | 'socks'

export interface ForwardPanelViewProps {
  forwards: readonly ForwardView[]
  connected: boolean
  onOpenLocal(localBind: string, remoteHost: string, remotePort: number): Promise<void>
  onOpenRemote(
    remoteBindHost: string,
    remoteBindPort: number,
    localHost: string,
    localPort: number,
  ): Promise<void>
  onOpenSocks(localBind: string): Promise<void>
  onClose(id: string): Promise<void>
}

export function ForwardPanelView({
  forwards,
  connected,
  onOpenLocal,
  onOpenRemote,
  onOpenSocks,
  onClose,
}: ForwardPanelViewProps) {
  const [kind, setKind] = useState<ForwardKind>('local')
  const [localBind, setLocalBind] = useState('')
  const [remoteHost, setRemoteHost] = useState('')
  const [remotePort, setRemotePort] = useState(0)
  const [remoteBindHost, setRemoteBindHost] = useState('')
  const [remoteBindPort, setRemoteBindPort] = useState(0)
  const [localHost, setLocalHost] = useState('')
  const [localPort, setLocalPort] = useState(0)

  const submit = async (): Promise<void> => {
    if (kind === 'local') await onOpenLocal(localBind, remoteHost, remotePort)
    else if (kind === 'socks') await onOpenSocks(localBind)
    else await onOpenRemote(remoteBindHost, remoteBindPort, localHost, localPort)
  }

  return (
    <section className="forwards">
      {!connected && <p>{t('forward.form.noSession')}</p>}

      <form
        className="forwards__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label htmlFor="forward-kind">{t('forward.form.kind')}</label>
        <select
          id="forward-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ForwardKind)}
        >
          <option value="local">{t('forward.form.local')}</option>
          <option value="remote">{t('forward.form.remote')}</option>
          <option value="socks">{t('forward.form.socks')}</option>
        </select>

        {kind !== 'remote' && (
          <>
            <label htmlFor="forward-local-bind">{t('forward.form.localBind')}</label>
            <input
              id="forward-local-bind"
              value={localBind}
              onChange={(e) => setLocalBind(e.target.value)}
              placeholder={t('forward.form.localBindPlaceholder')}
            />
          </>
        )}

        {kind === 'local' && (
          <>
            <label htmlFor="forward-remote-host">{t('forward.form.remoteHost')}</label>
            <input
              id="forward-remote-host"
              value={remoteHost}
              onChange={(e) => setRemoteHost(e.target.value)}
            />

            <label htmlFor="forward-remote-port">{t('forward.form.remotePort')}</label>
            <input
              id="forward-remote-port"
              type="number"
              min={1}
              max={65535}
              value={remotePort}
              onChange={(e) => setRemotePort(Number(e.target.value))}
            />
          </>
        )}

        {kind === 'remote' && (
          <>
            <label htmlFor="forward-remote-bind-host">{t('forward.form.remoteBindHost')}</label>
            <input
              id="forward-remote-bind-host"
              value={remoteBindHost}
              onChange={(e) => setRemoteBindHost(e.target.value)}
            />

            <label htmlFor="forward-remote-bind-port">{t('forward.form.remoteBindPort')}</label>
            <input
              id="forward-remote-bind-port"
              type="number"
              min={1}
              max={65535}
              value={remoteBindPort}
              onChange={(e) => setRemoteBindPort(Number(e.target.value))}
            />

            <label htmlFor="forward-local-host">{t('forward.form.localHost')}</label>
            <input
              id="forward-local-host"
              value={localHost}
              onChange={(e) => setLocalHost(e.target.value)}
            />

            <label htmlFor="forward-local-port">{t('forward.form.localPort')}</label>
            <input
              id="forward-local-port"
              type="number"
              min={1}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(Number(e.target.value))}
            />
          </>
        )}

        <button type="submit" disabled={!connected}>
          {t('forward.form.open')}
        </button>
      </form>

      <ul className="forwards__list">
        {forwards.map((forward) => (
          <li key={forward.id}>
            <span className="forward__description">{forward.description}</span>
            {forward.boundPort !== null && (
              <span className="forward__port">{t('forward.list.port', { n: forward.boundPort })}</span>
            )}
            {forward.acceptedCount > 0 && (
              <span className="forward__accepted">
                {t('forward.list.connections', { n: forward.acceptedCount })}
                {forward.lastPeer !== null && ` · ${t('forward.list.lastPeer', { peer: forward.lastPeer })}`}
              </span>
            )}
            {/* Core attaches any OS caveat; the panel just shows it (spec §5). */}
            {forward.note !== null && <span className="forward__note">{forward.note}</span>}

            <button
              type="button"
              aria-label={t('forward.list.closeAria', { description: forward.description })}
              onClick={() => void onClose(forward.id)}
            >
              {t('forward.form.close')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ForwardPanel({ app }: { app: App }) {
  const [sessionId, setSessionId] = useState<bigint | null>(null)
  const [forwards, setForwards] = useState<ForwardView[]>([])

  useEffect(() => {
    return app.sessions.onSessionState((id, state) => {
      if (state === 'connected') setSessionId(id)
      else if (state === 'closed') setSessionId((current) => (current === id ? null : current))
    })
  }, [app.sessions])

  useEffect(() => {
    setForwards(app.forwards.list())
    return app.forwards.onChange(() => setForwards(app.forwards.list()))
  }, [app.forwards])

  return (
    <ForwardPanelView
      forwards={forwards}
      connected={sessionId !== null}
      onOpenLocal={async (bind, host, port) => {
        if (sessionId === null) return
        await app.forwards.openLocal(sessionId, bind, host, port)
      }}
      onOpenRemote={async (bindHost, bindPort, localHost, localPort) => {
        if (sessionId === null) return
        await app.forwards.openRemote(sessionId, bindHost, bindPort, localHost, localPort)
      }}
      onOpenSocks={async (bind) => {
        if (sessionId === null) return
        await app.forwards.openSocks(sessionId, bind)
      }}
      onClose={(id) => app.forwards.close(id)}
    />
  )
}
