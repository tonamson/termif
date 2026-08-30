/* Mirror of src/renderer/styles/tokens.css. Change both together; the test in
   test/renderer/palette.test.ts fails if they drift. */
export const PALETTE = {
  bgApp: '#090d14',
  bgSurface: '#0f141d',
  bgRaised: '#161e2a',
  bgOverlay: '#1d2636',

  fg: '#f0f6fc',
  fgMuted: '#94a3b8',
  fgSubtle: '#64748b',

  accent: '#38bdf8',
  accentFg: '#090d14',

  ok: '#34d399',
  warn: '#fbbf24',
  danger: '#f87171',

  border: '#1e293b',
  borderStrong: '#334155',

  space0: '2px',
  space1: '4px',
  space2: '8px',
  space3: '12px',
  space4: '16px',
  space5: '24px',
  space6: '32px',

  radiusSm: '4px',
  radiusMd: '8px',

  fontUi: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",

  shadowOverlay: '0 20px 50px rgb(0 0 0 / 0.6)',

  motionFast: '120ms ease',

  titlebarH: '40px',
  sidebarW: '260px',
  sidebarRailW: '48px',
  inspectorW: '240px',

  zDrawer: 1,
  zInspector: 5,
  zSheet: 10,
  zPalette: 20,
} as const;
