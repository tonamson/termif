import { t } from '@termif/core'

export type DrawerTab = 'files' | 'forwards'

export interface TitlebarProps {
  drawerTab: DrawerTab | null
  onDrawerTab(tab: DrawerTab | null): void
  inspectorOpen: boolean
  onInspector(open: boolean): void
}

export function Titlebar({ drawerTab, onDrawerTab, inspectorOpen, onInspector }: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar__panes" role="tablist">
        {(['files', 'forwards'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={drawerTab === name}
            onClick={() => onDrawerTab(drawerTab === name ? null : name)}
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
// Keep old name for any stray import during migration
export type Pane = DrawerTab | 'terminals'
