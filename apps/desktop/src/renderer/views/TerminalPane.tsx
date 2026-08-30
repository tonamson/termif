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
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // Fit throws when the element is hidden; harmless.
      }
    })
    observer.observe(element)

    return () => {
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
