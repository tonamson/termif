import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import type { SessionManager } from '@termif/core'
import '@xterm/xterm/css/xterm.css'
import { terminalTheme } from '../styles/terminalTheme.js'

export interface TerminalPaneProps {
  tabId: string
  sessions: SessionManager
  active: boolean
}

/**
 * One xterm.js instance per tab. Bytes go from the SSH channel straight into
 * the emulator: core does not parse ANSI, because xterm.js does it better and
 * on the thread that draws (spec §6).
 */
export function TerminalPane({ tabId, sessions, active }: TerminalPaneProps) {
  const container = useRef<HTMLDivElement | null>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)

  // Keyed on tabId only: a re-render must not tear down a live terminal, and
  // `active` merely changes visibility.
  useEffect(() => {
    const element = container.current
    if (element === null) return

    const term = new Terminal({
      theme: terminalTheme,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      // Bounded so a chatty process cannot grow memory without limit.
      scrollback: 10_000,
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(element)
    // Let Cmd/Ctrl+W and Cmd/Ctrl+K bubble to the window handler that closes
    // the tab / toggles the palette — otherwise xterm would send 0x17 (Ctrl+W)
    // to the PTY and the shortcut would appear dead.
    const maybeAttach = (term as unknown as { attachCustomKeyEventHandler?: (cb: (e: KeyboardEvent) => boolean) => void })
      .attachCustomKeyEventHandler
    if (typeof maybeAttach === 'function') {
      maybeAttach.call(term, (event) => {
        const key = (event as KeyboardEvent).key.toLowerCase()
        if (((event as KeyboardEvent).metaKey || (event as KeyboardEvent).ctrlKey) && (key === 'w' || key === 'k')) return false
        return true
      })
    }

    // WebGL is a large throughput win but is unavailable in some VMs and
    // remote-desktop sessions; falling back to the DOM renderer is correct,
    // not an error worth surfacing.
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      // DOM renderer stays in place.
    }

    fitAddon.fit()
    terminal.current = term
    fit.current = fitAddon

    const unsubscribe = sessions.subscribeTab(tabId, (bytes) => {
      term.write(bytes)
    })

    const dataSub = term.onData((data) => {
      void sessions.writeToTab(tabId, new TextEncoder().encode(data))
    })

    const resizeSub = term.onResize(({ cols, rows }) => {
      void sessions.resizeTab(tabId, cols, rows)
    })

    // Refit on container size changes so a window resize reaches the remote PTY.
    let lastCols = term.cols
    let lastRows = term.rows
    let timer: ReturnType<typeof setTimeout> | null = null

    const refit = (): void => {
      const box = element.getBoundingClientRect()
      // A hidden panel reports 0×0; fitting then would collapse the terminal
      // to zero rows. The ResizeObserver fires again when the panel returns.
      if (box.width === 0 || box.height === 0) return
      try {
        fitAddon.fit()
      } catch {
        return
      }
      // Guard against both a wasted round trip and the classic observer loop:
      // fit() resizes the very element we observe.
      if (term.cols === lastCols && term.rows === lastRows) return
      lastCols = term.cols
      lastRows = term.rows
      // term.onResize will fire and call sessions.resizeTab; no direct call needed
    }

    const observer = new ResizeObserver(() => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        refit()
      }, 100)
    })
    observer.observe(element)

    return () => {
      if (timer !== null) clearTimeout(timer)
      observer.disconnect()
      resizeSub.dispose()
      dataSub.dispose()
      unsubscribe()
      term.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [sessions, tabId])

  useEffect(() => {
    if (active) {
      terminal.current?.focus()
      try {
        fit.current?.fit()
      } catch {
        // Hidden pane; nothing to fit.
      }
    }
  }, [active])

  return (
    <div
      ref={container}
      className="terminal-pane"
      // Kept mounted while hidden: unmounting would discard scrollback, and
      // reconnect explicitly promises to keep it (spec §6).
      style={{ display: active ? 'block' : 'none', height: '100%' }}
    />
  )
}
