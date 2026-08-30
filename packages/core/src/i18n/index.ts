import { en, type MessageKey } from './en.js'

const catalogues: Record<string, Readonly<Record<string, string>>> = { en }

let current = 'en'

/** v1 ships English only (spec §6); the machinery is here so adding a locale is a data change. */
export function availableLocales(): string[] {
  return Object.keys(catalogues)
}

export function setLocale(locale: string): void {
  current = locale in catalogues ? locale : 'en'
}

export function currentLocale(): string {
  return current
}

export function t(key: MessageKey, vars?: Readonly<Record<string, string | number>>): string {
  const catalogue = catalogues[current] ?? en
  const template = catalogue[key] ?? en[key]

  if (vars === undefined) return template
  // An unmatched placeholder stays visible: a blank in the UI hides the bug.
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name]
    return value === undefined ? whole : String(value)
  })
}

export type { MessageKey }
export { en }
