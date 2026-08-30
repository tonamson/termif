import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ansi, contrastRatio, palette } from '../../src/renderer/styles/palette.js'

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('returns 1 for a colour against itself', () => {
    expect(contrastRatio('#4c8dff', '#4c8dff')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#e6edf3', '#0d1117')).toBeCloseTo(
      contrastRatio('#0d1117', '#e6edf3'),
      5,
    )
  })
})

describe('palette contrast', () => {
  const backgrounds = ['bgApp', 'bgSurface', 'bgRaised', 'bgOverlay'] as const

  // Body text must be readable on every surface it can land on.
  for (const bg of backgrounds) {
    for (const fg of ['fg', 'fgMuted'] as const) {
      it(`${fg} on ${bg} meets AA for body text`, () => {
        expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  // Subtle text is placeholders and resting icons: large-text AA is the floor.
  for (const bg of backgrounds) {
    it(`fgSubtle on ${bg} meets AA for large text`, () => {
      expect(contrastRatio(palette.fgSubtle, palette[bg])).toBeGreaterThanOrEqual(3)
    })
  }

  // Focus rings and state dots must be distinguishable as UI, per WCAG 1.4.11.
  for (const key of ['accent', 'ok', 'warn', 'danger'] as const) {
    it(`${key} is a discernible UI colour on bgApp and bgRaised`, () => {
      expect(contrastRatio(palette[key], palette.bgApp)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(palette[key], palette.bgRaised)).toBeGreaterThanOrEqual(3)
    })
  }

  it('accentFg is readable on an accent fill', () => {
    expect(contrastRatio(palette.accentFg, palette.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('has 16 ANSI colours, all legible on the terminal ground', () => {
    expect(ansi).toHaveLength(16)
    // ANSI black is the exception: it is a background colour by convention.
    for (const colour of ansi.slice(1)) {
      expect(contrastRatio(colour, palette.bgApp)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('tokens.css mirrors the palette', () => {
  const css = readFileSync(
    join(__dirname, '../../src/renderer/styles/tokens.css'),
    'utf8',
  )

  // camelCase key -> --kebab-case custom property.
  const toVar = (key: string): string =>
    `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

  for (const [key, value] of Object.entries(palette)) {
    it(`defines ${toVar(key)} as ${value}`, () => {
      expect(css).toContain(`${toVar(key)}: ${value};`)
    })
  }

  it('defines the full space scale and both radii', () => {
    for (const [name, value] of [
      ['--space-1', '4px'],
      ['--space-2', '8px'],
      ['--space-3', '12px'],
      ['--space-4', '16px'],
      ['--space-5', '24px'],
      ['--space-6', '32px'],
      ['--radius-sm', '4px'],
      ['--radius-md', '8px'],
    ]) {
      expect(css).toContain(`${name}: ${value};`)
    }
  })

  it('declares no light-theme block', () => {
    expect(css).not.toContain('prefers-color-scheme')
  })
})
