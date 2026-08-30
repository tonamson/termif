import { t, type SyncStatus } from '@termif/core'

export interface SyncBadgeProps {
  status: SyncStatus
  onSyncNow(): void
}

export function SyncBadge({ status, onSyncNow }: SyncBadgeProps) {
  const text = (): string => {
    if (status.state === 'running') return t('sync.running')
    if (status.state === 'failed') {
      const code = status.lastError?.code
      // Quota is common and self-healing, so it gets its own calmer message.
      return code === 'sheet_quota'
        ? t('sync.quota')
        : t('sync.failed', { reason: status.lastError?.message ?? '' })
    }
    return status.lastSuccessAt === null
      ? t('sync.idle', { when: 'never' })
      : t('sync.idle', { when: new Date(status.lastSuccessAt).toLocaleTimeString() })
  }

  return (
    <button
      type="button"
      className={`sync-badge sync-badge--${status.state}`}
      onClick={onSyncNow}
      title={t('sync.now')}
    >
      {text()}
    </button>
  )
}
