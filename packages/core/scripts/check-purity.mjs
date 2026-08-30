#!/usr/bin/env node
// Fails if packages/core/src imports anything platform-specific. Core reaches
// the outside world only through the injected `Platform` interface (spec §6).

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

const FORBIDDEN = [
  'electron',
  'react-native',
  'react',
  'react-dom',
  '@react-native-async-storage/async-storage',
  'node:fs',
  'node:path',
  'node:os',
  'node:child_process',
  'node:crypto',
  'fs',
  'path',
  'os',
  'child_process',
  'crypto',
]

/** Matches the module specifier of a static import, export-from, or require. */
const SPECIFIER = /(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.ts')) yield full
  }
}

const violations = []

for await (const file of walk(SRC)) {
  const source = await readFile(file, 'utf8')
  const lines = source.split('\n')

  for (const [index, line] of lines.entries()) {
    // Skip comments so a mention in prose is not a violation.
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    for (const match of line.matchAll(SPECIFIER)) {
      const specifier = match[1]
      if (FORBIDDEN.includes(specifier)) {
        violations.push(`${file}:${index + 1}: forbidden import of "${specifier}"`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error('packages/core must not import platform modules:\n')
  for (const violation of violations) console.error(`  ${violation}`)
  console.error(
    '\nReach the platform through the injected `Platform` interface instead.',
  )
  process.exit(1)
}

console.log('purity check passed: core imports no platform modules')
