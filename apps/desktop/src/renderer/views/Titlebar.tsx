import { t } from '@termif/core'

export type Pane = 'terminals' | 'files' | 'forwards'

export interface TitlebarProps {
  pane: Pane
  onPaneChange(pane: Pane): void
}

/**
 * The window is frameless (see src/main/index.ts), so this bar is both the
 * drag handle and the pane switcher. Anything clickable inside it must opt out
 * of the drag region in CSS, or it stops responding to clicks.
 */
export function Titlebar({ pane, onPaneChange }: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar__panes" role="tablist">
        {(['terminals', 'files', 'forwards'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={pane === name}
            onClick={() => onPaneChange(name)}
          >
            {t(`layout.tab.${name}`)}
          </button>
        ))}
      </div>
    </header>
  )
}
