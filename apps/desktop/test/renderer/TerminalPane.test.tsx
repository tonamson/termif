import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TerminalPane } from '../../src/renderer/views/TerminalPane.js'
import { palette } from '../../src/renderer/styles/palette.js'
import { FitAddon } from '@xterm/addon-fit'

/**
 * xterm.js needs a real canvas and layout, which jsdom does not provide, so the
 * addons are stubbed and the Terminal is replaced by a recorder. What is under
 * test is the wiring — subscribe, write, send input, resize, dispose — not the
 * emulator, which has its own test suite upstream.
 */
const written: (string | Uint8Array)[] = []
const disposed: string[] = []
let onDataHandler: ((data: string) => void) | null = null
let onResizeHandler: ((size: { cols: number; rows: number }) => void) | null = null
const constructed: { theme?: Record<string, string>; fontFamily?: string }[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    constructor(options: { theme?: Record<string, string>; fontFamily?: string }) {
      constructed.push(options)
    }
    open = vi.fn()
    loadAddon = vi.fn()
    focus = vi.fn()
    write(data: string | Uint8Array) {
      written.push(data)
    }
    onData(handler: (data: string) => void) {
      onDataHandler = handler
      return { dispose: () => disposed.push('onData') }
    }
    onResize(handler: (size: { cols: number; rows: number }) => void) {
      onResizeHandler = handler
      return { dispose: () => disposed.push('onResize') }
    }
    dispose() {
      disposed.push('terminal')
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    static instances: { fit: ReturnType<typeof vi.fn> }[] = []
    fit = vi.fn()
    dispose = vi.fn()
    constructor() {
      // @ts-ignore - static on mock class
      ;(this.constructor as typeof FitAddon).instances.push(this as never)
    }
  },
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose = vi.fn()
  },
}))

function makeSessions() {
  const subscribers = new Map<string, (bytes: Uint8Array) => void>()
  return {
    subscribeTab: vi.fn((tab: string, onData: (bytes: Uint8Array) => void) => {
      subscribers.set(tab, onData)
      return () => subscribers.delete(tab)
    }),
    writeToTab: vi.fn(async () => {}),
    resizeTab: vi.fn(async () => {}),
    emit(tab: string, bytes: Uint8Array) {
      subscribers.get(tab)?.(bytes)
    },
    subscriberCount: () => subscribers.size,
  }
}

describe('TerminalPane', () => {
  it('writes incoming bytes straight to the terminal', async () => {
    written.length = 0
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    const bytes = new TextEncoder().encode('hello')
    sessions.emit('t1', bytes)

    await waitFor(() => expect(written).toContain(bytes))
  })

  it('passes raw bytes rather than decoding them, so the emulator handles UTF-8', async () => {
    written.length = 0
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    // A multi-byte character split across two chunks would break if we decoded
    // per chunk; xterm.js reassembles it.
    const first = new Uint8Array([0xe2, 0x9c])
    const second = new Uint8Array([0x93])
    sessions.emit('t1', first)
    sessions.emit('t1', second)

    await waitFor(() => {
      expect(written).toContain(first)
      expect(written).toContain(second)
    })
    expect(written.every((w) => w instanceof Uint8Array)).toBe(true)
  })

  it('sends typed input to its tab', async () => {
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    onDataHandler?.('ls\r')

    await waitFor(() =>
      expect(sessions.writeToTab).toHaveBeenCalledWith('t1', new TextEncoder().encode('ls\r')),
    )
  })

  it('reports a resize to its tab', async () => {
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    onResizeHandler?.({ cols: 132, rows: 43 })

    await waitFor(() => expect(sessions.resizeTab).toHaveBeenCalledWith('t1', 132, 43))
  })

  it('unsubscribes and disposes on unmount, so a closed tab leaks nothing', () => {
    disposed.length = 0
    const sessions = makeSessions()
    const { unmount } = render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    unmount()

    expect(sessions.subscriberCount()).toBe(0)
    expect(disposed).toContain('terminal')
  })

  it('subscribes once even across re-renders', () => {
    const sessions = makeSessions()
    const { rerender } = render(<TerminalPane tabId="t1" sessions={sessions as never} active />)
    rerender(<TerminalPane tabId="t1" sessions={sessions as never} active />)
    rerender(<TerminalPane tabId="t1" sessions={sessions as never} active={false} />)

    expect(sessions.subscribeTab).toHaveBeenCalledTimes(1)
  })

  async function fireObserver(): Promise<void> {
    const stub = (globalThis as unknown as { ResizeObserverStub: { instances: { fire(): void }[] } })
      .ResizeObserverStub.instances.at(-1)!
    stub.fire()
  }

  it('does not fit while the container measures 0x0 (hidden panel)', async () => {
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)
    vi.spyOn(document.querySelector('.terminal-pane')!, 'getBoundingClientRect')
      .mockReturnValue({ width: 0, height: 0 } as DOMRect)
    ;(FitAddon as unknown as { instances: { fit: ReturnType<typeof vi.fn> }[] }).instances.at(-1)!.fit.mockClear()

    await fireObserver()
    // The refit throttle is 100ms; give it room to have fired if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect((FitAddon as unknown as { instances: { fit: ReturnType<typeof vi.fn> }[] }).instances.at(-1)!.fit).not.toHaveBeenCalled()
  })

  it('still fits at a real size', async () => {
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)
    vi.spyOn(document.querySelector('.terminal-pane')!, 'getBoundingClientRect')
      .mockReturnValue({ width: 800, height: 600 } as DOMRect)
    ;(FitAddon as unknown as { instances: { fit: ReturnType<typeof vi.fn> }[] }).instances.at(-1)!.fit.mockClear()

    await fireObserver()
    await waitFor(() => expect((FitAddon as unknown as { instances: { fit: ReturnType<typeof vi.fn> }[] }).instances.at(-1)!.fit).toHaveBeenCalled())
  })

  it('opens the terminal with the app theme so it matches the window ground', async () => {
    render(<TerminalPane tabId="t1" sessions={makeSessions() as never} active />)

    await waitFor(() => expect(constructed.length).toBeGreaterThan(0))
    const options = constructed[constructed.length - 1]!

    expect(options.theme?.background).toBe(palette.bgApp)
    expect(options.theme?.foreground).toBe(palette.fg)
    expect(options.theme?.cursor).toBe(palette.accent)
    // All 16 ANSI slots present: a missing one silently falls back to xterm's.
    expect(options.theme?.brightWhite).toBeTruthy()
    expect(options.theme?.black).toBeTruthy()
  })
})
