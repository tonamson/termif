import { t, type TransferView } from '@termif/core'

export function formatBytes(bytes: bigint): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Number(bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

export function percentOf(done: bigint, total: bigint): number {
  // A transfer reports total 0 until the first progress event arrives.
  if (total === 0n) return 0
  return Math.min(100, Math.floor(Number((done * 100n) / total)))
}

export interface TransferListProps {
  transfers: readonly TransferView[]
  onCancel(id: string): void
}

export function TransferList({ transfers, onCancel }: TransferListProps) {
  if (transfers.length === 0) return null

  return (
    <ul className="transfer-list">
      {transfers.map((transfer) => (
        <li key={transfer.id} className={`transfer transfer--${transfer.state}`}>
          <span className="transfer__name">
            {transfer.kind === 'upload' ? '↑' : '↓'} {transfer.remote}
          </span>

          <progress
            className="transfer__progress"
            value={percentOf(transfer.done, transfer.total)}
            max={100}
            aria-label={`${percentOf(transfer.done, transfer.total)}%${transfer.total > 0n ? ` · ${formatBytes(transfer.done)} / ${formatBytes(transfer.total)}` : ''}`}
          >
            {percentOf(transfer.done, transfer.total)}%
            {transfer.total > 0n && ` · ${formatBytes(transfer.done)} / ${formatBytes(transfer.total)}`}
          </progress>

          {transfer.error !== null && (
            <span className="transfer__error">{t('transfer.failed', { reason: transfer.error })}</span>
          )}

          {(transfer.state === 'running' || transfer.state === 'queued') && (
            <button type="button" onClick={() => onCancel(transfer.id)}>
              {t('transfer.cancel')}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
