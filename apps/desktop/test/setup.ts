// Registers the jest-dom matchers (`toBeInTheDocument`, `toHaveValue`, ...)
// used across the renderer component tests.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Without a global `afterEach` (vitest globals are off) RTL cannot register
// its own auto-cleanup, so renders leak across tests within a file and
// `getBy*` queries hit duplicate elements. Register it here instead.
afterEach(() => cleanup())
