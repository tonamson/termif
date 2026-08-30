// Registers the jest-dom matchers (`toBeInTheDocument`, `toHaveValue`, ...)
// used across the renderer component tests.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not implement ResizeObserver, which TerminalPane uses to refit on
// container size changes. Supply a no-op so the component mounts under test;
// pane fit is exercised directly via onResize/onData handlers.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// Without a global `afterEach` (vitest globals are off) RTL cannot register
// its own auto-cleanup, so renders leak across tests within a file and
// `getBy*` queries hit duplicate elements. Register it here instead.
afterEach(() => cleanup())
