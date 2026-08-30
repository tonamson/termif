// Registers the jest-dom matchers (`toBeInTheDocument`, `toHaveValue`, ...)
// used across the renderer component tests.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom has no ResizeObserver. The stub records instances so a test can fire a
// resize by hand — the real one never fires in jsdom, and TerminalPane's whole
// job is reacting to it.
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []
  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  fire(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
;(globalThis as Record<string, unknown>).ResizeObserverStub = ResizeObserverStub

// Without a global `afterEach` (vitest globals are off) RTL cannot register
// its own auto-cleanup, so renders leak across tests within a file and
// `getBy*` queries hit duplicate elements. Register it here instead.
afterEach(() => cleanup())
