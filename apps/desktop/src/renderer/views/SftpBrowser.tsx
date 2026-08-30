import { useEffect, useState } from 'react'
import { t, type SshDirEntry, type TransferView } from '@termif/core'
import type { App } from '../state/boot.js'
import { createSftpStore, joinPath } from '../state/sftpStore.js'
import { useStore } from '../state/useStore.js'
import { formatBytes, TransferList } from './TransferList.js'

export interface SftpBrowserViewProps {
  path: string
  entries: readonly SshDirEntry[]
  loading: boolean
  error: string | null
  onOpen(path: string): void
  onUp(): void
  onRefresh(): void
  onMkdir(name: string): Promise<void>
  onRemove(name: string, recursive: boolean): Promise<void>
  onUpload(): Promise<void>
  onDownload(name: string): Promise<void>
}

export function SftpBrowserView({
  path,
  entries,
  loading,
  error,
  onOpen,
  onUp,
  onRefresh,
  onMkdir,
  onRemove,
  onUpload,
  onDownload,
}: SftpBrowserViewProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [newDir, setNewDir] = useState('')

  return (
    <section className="sftp">
      <header className="sftp__bar">
        <button type="button" onClick={onUp}>
          {t('sftp.up')}
        </button>
        <code className="sftp__path">{path}</code>
        <button type="button" onClick={onRefresh}>
          {t('sftp.refresh')}
        </button>
        <button
          type="button"
          aria-label={t('sftp.uploadAria')}
          onClick={() => void onUpload()}
        >
          {t('sftp.upload')}
        </button>

        <input
          aria-label={t('sftp.newFolderLabel')}
          placeholder={t('sftp.newFolder')}
          value={newDir}
          onChange={(e) => setNewDir(e.target.value)}
        />
        <button
          type="button"
          disabled={newDir.trim().length === 0}
          onClick={() => {
            void onMkdir(newDir.trim())
            setNewDir('')
          }}
        >
          {t('sftp.create')}
        </button>
      </header>

      {error !== null && <p role="alert">{error}</p>}
      {loading && <p role="status">{t('sftp.loading')}</p>}

      <ul className="sftp__entries">
        {entries.map((entry) => (
          <li key={entry.name} onDoubleClick={() => entry.isDir && onOpen(joinPath(path, entry.name))}>
            <span className="sftp__icon">{entry.isDir ? '📁' : '📄'}</span>
            <span className="sftp__name">{entry.name}</span>

            {/* A directory's byte size means nothing to a user, so omit it. */}
            {!entry.isDir && <span className="sftp__size">{formatBytes(entry.size)}</span>}

            {!entry.isDir && (
              <button
                type="button"
                aria-label={t('sftp.download', { name: entry.name })}
                onClick={() => void onDownload(entry.name)}
              >
                {t('sftp.downloadShort')}
              </button>
            )}

            {confirming === entry.name ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(null)
                    // Removing a directory has to be recursive to succeed, and
                    // saying so is the point of the confirmation.
                    void onRemove(entry.name, entry.isDir)
                  }}
                >
                  {entry.isDir ? t('sftp.confirmDeleteFolder') : t('sftp.confirmDelete')}
                </button>
                <button type="button" onClick={() => setConfirming(null)}>
                  {t('sftp.keep')}
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={t('sftp.delete', { name: entry.name })}
                onClick={() => setConfirming(entry.name)}
              >
                {t('sftp.deleteShort')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Wired half. Outer gate never calls `useStore`; inner always does. */
export function SftpBrowser({ app }: { app: App }) {
  const [sessionId, setSessionId] = useState<bigint | null>(null)
  const [transfers, setTransfers] = useState<TransferView[]>([])

  useEffect(() => {
    // Follow the most recent session so the browser opens where the user is.
    return app.sessions.onSessionState((id, state) => {
      if (state === 'connected') setSessionId(id)
      else if (state === 'closed') setSessionId((current) => (current === id ? null : current))
    })
  }, [app.sessions])

  useEffect(() => {
    setTransfers(app.transfers.list())
    return app.transfers.onChange(() => setTransfers(app.transfers.list()))
  }, [app.transfers])

  if (sessionId === null) {
    return <p>{t('sftp.noSession')}</p>
  }

  return (
    <SftpBrowserSession
      key={sessionId.toString()}
      app={app}
      sessionId={sessionId}
      transfers={transfers}
    />
  )
}

function SftpBrowserSession({
  app,
  sessionId,
  transfers,
}: {
  app: App
  sessionId: bigint
  transfers: readonly TransferView[]
}) {
  const [store] = useState(() => {
    const created = createSftpStore({ ssh: app.platform.ssh, sessionId })
    void created.open('.')
    return created
  })
  const state = useStore(store)

  return (
    <>
      <SftpBrowserView
        path={state.path}
        entries={state.entries}
        loading={state.loading}
        error={state.error}
        onOpen={(next) => void store.open(next)}
        onUp={() => void store.up()}
        onRefresh={() => void store.refresh()}
        onMkdir={(name) => store.mkdir(name)}
        onRemove={(name, recursive) => store.remove(name, recursive)}
        onUpload={async () => {
          const local = await window.termif.app.pickFile()
          if (local === null) return
          const name = local.split(/[/\\]/).pop() ?? 'upload'
          await app.transfers.enqueueUpload(sessionId, local, joinPath(state.path, name))
        }}
        onDownload={async (name) => {
          const local = await window.termif.app.pickSaveLocation(name)
          if (local === null) return
          await app.transfers.enqueueDownload(sessionId, joinPath(state.path, name), local)
        }}
      />
      <TransferList transfers={transfers} onCancel={(id) => void app.transfers.cancel(id)} />
    </>
  )
}
