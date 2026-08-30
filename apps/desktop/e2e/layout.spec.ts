import { test, expect } from '@playwright/test'
// Placeholder: real layout invariants need Electron + hostile DB.
// This file exists so Task 14's structure is present; invariants are
// enforced manually until the Electron harness lands.

test.describe('layout invariants (placeholder)', () => {
  test('no overflow at six widths - skipped without Electron', async () => {
    test.skip(true, 'needs Electron to measure real geometry')
  })
})
