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
      <div className="titlebar__drag">
        <span className="titlebar__brand">
          Termif <span className="titlebar__brand-badge">SSH</span>
        </span>
      </div>

      <div className="titlebar__panes titlebar__nav" role="tablist" aria-label={t('layout.panels')}>
        {(['terminal', 'files', 'forwards'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={panel === name}
            data-active={panel === name}
            onClick={() => onPanel(name)}
          >
            {t(`layout.tab.${name}`)}
          </button>
        ))}
      </div>

      <div className="titlebar__actions">
        <button
          type="button"
          className="titlebar__inspector titlebar__btn"
          aria-pressed={inspectorOpen}
          data-active={inspectorOpen}
          aria-label={t('layout.inspector')}
          onClick={() => onInspector(!inspectorOpen)}
          title="Toggle Inspector"
        >
          ⓘ
        </button>
      </div>
    </header>
  )
}
