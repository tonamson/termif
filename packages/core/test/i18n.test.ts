import { beforeEach, describe, expect, it } from 'vitest'
import { availableLocales, setLocale, t } from '../src/i18n/index.js'
import { en } from '../src/i18n/en.js'

describe('t', () => {
  beforeEach(() => setLocale('en'))

  it('returns the English message for a known key', () => {
    expect(t('error.auth.failed')).toBe('Authentication failed. Check the username and credential.')
  })

  it('interpolates named variables', () => {
    expect(t('hostkey.unknown.title', { host: 'example.com' })).toBe(
      'First connection to example.com',
    )
  })

  it('leaves an unmatched placeholder visible rather than printing undefined', () => {
    // A missing variable is a bug we want to see in the UI, not silently blank.
    expect(t('hostkey.unknown.title')).toBe('First connection to {host}')
  })

  it('lists en as the only locale in v1', () => {
    expect(availableLocales()).toEqual(['en'])
  })

  it('falls back to English when an unknown locale is selected', () => {
    setLocale('fr')
    expect(t('error.auth.failed')).toBe(en['error.auth.failed'])
  })

  it('has no empty strings in the catalogue', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, `empty message for ${key}`).toBeGreaterThan(0)
    }
  })
})
