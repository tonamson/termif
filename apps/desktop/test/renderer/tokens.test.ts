import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tokens = readFileSync(join(__dirname, '../../src/renderer/styles/tokens.css'), 'utf8')
const app = readFileSync(join(__dirname, '../../src/renderer/styles/app.css'), 'utf8')

describe('tokens.css', () => {
  for (const name of [
    '--sidebar-w',
    '--inspector-w',
    '--z-drawer',
    '--z-inspector',
    '--z-sheet',
    '--z-palette',
    '--space-0',
  ]) {
    it(`defines ${name}`, () => {
      expect(tokens).toContain(`${name}:`)
    })
  }
})

describe('app.css layout rules', () => {
  it('gives the main column an explicit zero minimum', () => {
    expect(app).toContain('minmax(0, 1fr)')
  })

  it('uses no bare z-index values', () => {
    const bare = app.match(/z-index:\s*\d+/g) ?? []
    expect(bare).toEqual([])
  })

  it('does not size the transfer list as a percentage of a flex item', () => {
    expect(app).not.toContain('max-height: 30%')
  })
})
