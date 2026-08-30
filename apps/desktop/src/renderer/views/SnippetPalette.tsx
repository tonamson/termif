import type { App } from '../state/boot.js'

export interface SnippetPaletteProps {
  app: App
  onSend(body: string): Promise<void>
  onClose(): void
}

// Arrives in Task 9. Stubbed so the terminal-tabs tree compiles until then.
export function SnippetPalette(props: SnippetPaletteProps) {
  void props
  return null
}
