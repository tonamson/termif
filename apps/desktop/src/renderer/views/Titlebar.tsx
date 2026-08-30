import { t } from '@termif/core'

export type MainPanel = 'terminal' | 'files' | 'forwards'

export interface TitlebarProps {
  panel: MainPanel
  onPanel(panel: MainPanel): void
  inspectorOpen: boolean
  onInspector(open: boolean): void
}

export function Titlebar({ panel, onPanel, inspectorOpen, onInspector }: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar__panes" role="tablist" aria-label={t('layout.panels')}>
        {(['terminal', 'files', 'forwards'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={panel === name}
            onClick={() => onPanel(name)}
          >
            {t(`layout.tab.${name}`)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="titlebar__inspector"
        aria-pressed={inspectorOpen}
        aria-label={t('layout.inspector')}
        onClick={() => onInspector(!inspectorOpen)}
      >
        ⓘ
      </button>
    </header>
  )
}
