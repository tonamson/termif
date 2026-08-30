import { ansi, palette } from './palette.js'

/**
 * xterm's own default is pure black, which does not match --bg-app and shows
 * as a seam around the pane. These are the same values the CSS uses.
 */
export const terminalTheme = {
  background: palette.bgApp,
  foreground: palette.fg,
  cursor: palette.accent,
  cursorAccent: palette.bgApp,
  selectionBackground: '#2d4a6b',

  black: ansi[0],
  red: ansi[1],
  green: ansi[2],
  yellow: ansi[3],
  blue: ansi[4],
  magenta: ansi[5],
  cyan: ansi[6],
  white: ansi[7],
  brightBlack: ansi[8],
  brightRed: ansi[9],
  brightGreen: ansi[10],
  brightYellow: ansi[11],
  brightBlue: ansi[12],
  brightMagenta: ansi[13],
  brightCyan: ansi[14],
  brightWhite: ansi[15],
} as const
