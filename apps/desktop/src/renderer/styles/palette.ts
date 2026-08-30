/**
 * The single source of truth for colour. `tokens.css` mirrors these values for
 * CSS, and `terminalTheme.ts` reshapes them for xterm; a test in
 * `test/renderer/palette.test.ts` keeps the mirror honest and checks every
 * pair against WCAG AA.
 */
export const palette = {
  // Four background levels. Depth reads as lightness, not as borders.
  bgApp: '#0d1117',
  bgSurface: '#12171f',
  bgRaised: '#1b222c',
  bgOverlay: '#212a35',

  // Three foreground levels.
  fg: '#e6edf3',
  fgMuted: '#a7b3c0',
  fgSubtle: '#8b98a6',

  // One accent, for focus and the primary action.
  accent: '#4c8dff',
  accentFg: '#0d1117',

  // Semantic colours. State only, never decoration.
  ok: '#3fb950',
  warn: '#d29922',
  danger: '#f85149',

  border: '#232c38',
  borderStrong: '#3a4553',
} as const

export type PaletteKey = keyof typeof palette

/** xterm order: 8 normal, then 8 bright. */
export const ansi = [
  '#484f58', '#ff7b72', '#3fb950', '#d29922',
  '#6ca6ff', '#bc8cff', '#39c5cf', '#b1bac4',
  '#6e7681', '#ffa198', '#56d364', '#e3b341',
  '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc',
] as const

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = channel((n >> 16) & 0xff)
  const g = channel((n >> 8) & 0xff)
  const b = channel(n & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 relative-luminance contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
