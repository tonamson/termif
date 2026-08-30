import { Icon } from '../components/Icon'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t, type SshDirEntry, type TransferView } from '@termif/core'
import type { App } from '../state/boot.js'
import { createSftpStore, joinPath, type SftpStore } from '../state/sftpStore.js'
import { createLocalStore, joinLocal, type LocalStore } from '../state/localStore.js'
import { useStore } from '../state/useStore.js'
import { formatBytes, TransferList } from './TransferList.js'

/** Which side of a copy a pane is showing. */
export type FileSource = 'local' | 'remote'

/** What a drag between panes carries: the source side and the file's name. */
export const DRAG_TYPE = 'application/x-termif-file'

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
  /** Rendered at the head of the toolbar. The dual-pane shell puts its source picker here. */
  header?: ReactNode
  /** False for a pane that can only be read, which is what the local side is today. */
  canModify?: boolean
  /** Copies one entry to the other pane. Absent when there is nowhere to copy to. */
  onSend?: (name: string) => void
  /** A file was dragged in from the other pane. */
  onReceive?: (name: string) => void
  /** How to build a child path. Local panes need the OS separator, not POSIX. */
  join?: (base: string, name: string) => string
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
  header,
  canModify = true,
  onSend,
  onReceive,
  join = joinPath,
}: SftpBrowserViewProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [newDir, setNewDir] = useState('')
  const [dropping, setDropping] = useState(false)

  return (
    <section
      className="sftp"
      data-dropping={dropping ? 'yes' : 'no'}
      onDragOver={(event) => {
        if (onReceive === undefined) return
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        setDropping(false)
        if (onReceive === undefined) return
        event.preventDefault()
        const name = event.dataTransfer.getData(DRAG_TYPE)
        if (name !== '') onReceive(name)
      }}
    >
      <header className="sftp__bar">
        {header}
        <button type="button" onClick={onUp}>
          {t('sftp.up')}
        </button>
        <code className="sftp__path">{path}</code>
        <button type="button" onClick={onRefresh}>
          {t('sftp.refresh')}
        </button>
        {canModify && (
          <button
            type="button"
            aria-label={t('sftp.uploadAria')}
            onClick={() => void onUpload()}
          >
            {t('sftp.upload')}
          </button>
        )}

        {canModify && (
          <>
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
          </>
        )}
      </header>

      {error !== null && <p role="alert">{error}</p>}
      {loading && <p role="status">{t('sftp.loading')}</p>}

      <ul className="sftp__entries u-scroll">
        {entries.map((entry) => (
          <li
            key={entry.name}
            draggable={onSend !== undefined && !entry.isDir}
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, entry.name)
              event.dataTransfer.effectAllowed = 'copy'
            }}
            onDoubleClick={() => entry.isDir && onOpen(join(path, entry.name))}
          >
            <span className="sftp__icon"><Icon name={entry.isDir ? "folder" : "description"} size={16} /></span>
            <span className="sftp__name u-clip">{entry.name}</span>

            {/* A directory's byte size means nothing to a user, so omit it. */}
            {!entry.isDir && <span className="sftp__size">{formatBytes(entry.size)}</span>}

            {onSend !== undefined && !entry.isDir && (
              <button
                type="button"
                aria-label={t('sftp.send', { name: entry.name })}
                title={t('sftp.sendShort')}
                onClick={() => onSend(entry.name)}
              >
                {t('sftp.sendShort')}
              </button>
            )}

            {canModify && !entry.isDir && (
              <button
                type="button"
                aria-label={t('sftp.download', { name: entry.name })}
                onClick={() => void onDownload(entry.name)}
              >
                {t('sftp.downloadShort')}
              </button>
            )}

            {canModify &&
              (confirming === entry.name ? (
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
              ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Wired half. Outer gate never calls `useStore`; inner always does. */
export function SftpBrowser({ app }: { app: App }) {
  // The drawer mounts long after the connection, so start from the sessions
  // that are already open rather than waiting for a state event that has been
  // and gone.
  const [sessionId, setSessionId] = useState<bigint | null>(
    () => app.sessions.openSessionIds()[0] ?? null,
  )
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

function SourcePicker({
  value,
  onChange,
}: {
  value: FileSource
  onChange(value: FileSource): void
}) {
  return (
    <select
      className="sftp__source"
      aria-label={t('sftp.sourceLabel')}
      value={value}
      onChange={(e) => onChange(e.target.value as FileSource)}
    >
      <option value="local">{t('sftp.local')}</option>
      <option value="remote">{t('sftp.remote')}</option>
    </select>
  )
}

/**
 * Two panes, each pointed at either side of the connection. The stores belong
 * to the *source*, not to the pane: pointing both panes at the same place then
 * shows one listing twice instead of fighting over two copies of it.
 */
function SftpBrowserSession({
  app,
  sessionId,
  transfers,
}: {
  app: App
  sessionId: bigint
  transfers: readonly TransferView[]
}) {
  const [remote] = useState<SftpStore>(() => {
    const created = createSftpStore({ ssh: app.platform.ssh, sessionId })
    void created.open('.')
    return created
  })
  // The separator arrives from the main process after mount, so the store reads
  // it through a ref rather than closing over a stale render's value.
  const sep = useRef('/')
  const [local] = useState<LocalStore>(() =>
    createLocalStore({
      list: async (path) =>
        (await window.termif.app.localList(path)).map((e) => ({ ...e, size: BigInt(e.size) })),
      get sep() {
        return sep.current
      },
    }),
  )

  const [sources, setSources] = useState<[FileSource, FileSource]>(['local', 'remote'])
  const [copyError, setCopyError] = useState<string | null>(null)

  useEffect(() => {
    void window.termif.app.localHome().then((home) => {
      sep.current = home.sep
      void local.open(home.path)
    })
  }, [local])

  const remoteState = useStore(remote)
  const localState = useStore(local)

  const stateOf = (source: FileSource) => (source === 'local' ? localState : remoteState)
  const storeOf = (source: FileSource) => (source === 'local' ? local : remote)

  /** Copies one file across the connection. Same-side copies are not a transfer. */
  const copy = async (from: FileSource, name: string): Promise<void> => {
    const to: FileSource = from === 'local' ? 'remote' : 'local'
    if (sources[0] === sources[1]) {
      setCopyError(t('sftp.sameSource'))
      return
    }
    setCopyError(null)
    const localPath = joinLocal(localState.path, name, sep.current)
    const remotePath = joinPath(remoteState.path, name)
    if (to === 'remote') await app.transfers.enqueueUpload(sessionId, localPath, remotePath)
    else await app.transfers.enqueueDownload(sessionId, remotePath, localPath)
    void storeOf(to).refresh()
  }

  const pane = (index: 0 | 1): ReactNode => {
    const source = sources[index]
    const state = stateOf(source)
    const store = storeOf(source)
    const canModify = source === 'remote'
    const canCopy = sources[0] !== sources[1]

    return (
      <SftpBrowserView
        key={index}
        path={state.path}
        entries={state.entries}
        loading={state.loading}
        error={state.error}
        header={
          <SourcePicker
            value={source}
            onChange={(next) =>
              setSources((current) =>
                index === 0 ? [next, current[1]] : [current[0], next],
              )
            }
          />
        }
        canModify={canModify}
        join={source === 'local' ? (base, name) => joinLocal(base, name, sep.current) : joinPath}
        onOpen={(next) => void store.open(next)}
        onUp={() => void store.up()}
        onRefresh={() => void store.refresh()}
        onMkdir={(name) => (canModify ? remote.mkdir(name) : Promise.resolve())}
        onRemove={(name, recursive) =>
          canModify ? remote.remove(name, recursive) : Promise.resolve()
        }
        {...(canCopy ? { onSend: (name: string) => void copy(source, name) } : {})}
        {...(canCopy
          ? { onReceive: (name: string) => void copy(source === 'local' ? 'remote' : 'local', name) }
          : {})}
        onUpload={async () => {
          const picked = await window.termif.app.pickFile()
          if (picked === null) return
          const name = picked.split(/[/\\]/).pop() ?? 'upload'
          await app.transfers.enqueueUpload(sessionId, picked, joinPath(remoteState.path, name))
        }}
        onDownload={async (name) => {
          const target = await window.termif.app.pickSaveLocation(name)
          if (target === null) return
          await app.transfers.enqueueDownload(sessionId, joinPath(remoteState.path, name), target)
        }}
      />
    )
  }

  return (
    <>
      {copyError !== null && <p role="alert">{copyError}</p>}
      <div className="sftp-panes">
        {pane(0)}
        {pane(1)}
      </div>
      <TransferList transfers={transfers} onCancel={(id) => void app.transfers.cancel(id)} />
    </>
  )
}
