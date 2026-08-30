import React from 'react'
import ReactDOM from 'react-dom/client'
import { boot } from './state/boot.js'
import { MainLayout } from './views/MainLayout.js'
import './styles/app.css'

// Comprehensive Renderer Action & Interaction Logger
function initGlobalActionLogging() {
  if (typeof window === 'undefined' || !window.termif?.app?.log) return

  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    originalLog(...args)
    void window.termif.app.log(
      'info',
      'renderer:console',
      args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
    )
  }

  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    void window.termif.app.log(
      'warn',
      'renderer:console',
      args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
    )
  }

  console.error = (...args: unknown[]) => {
    originalError(...args)
    void window.termif.app.log(
      'error',
      'renderer:console',
      args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
    )
  }

  window.addEventListener('error', (event) => {
    void window.termif.app.log(
      'error',
      'renderer:unhandled',
      `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    void window.termif.app.log('error', 'renderer:unhandledRejection', String(event.reason?.stack || event.reason))
  })

  // Full Click & Interaction Telemetry
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName.toLowerCase()
      const cls = target.className ? `.${String(target.className).split(' ').join('.')}` : ''
      const id = target.id ? `#${target.id}` : ''
      const label =
        target.getAttribute('aria-label') ||
        target.getAttribute('title') ||
        target.innerText?.slice(0, 40).replace(/\s+/g, ' ') ||
        ''
      const info = `${tag}${id}${cls} [text: "${label}"] (x:${event.clientX}, y:${event.clientY})`
      void window.termif.app.log('info', 'ui:click', info)
    },
    true,
  )

  document.addEventListener(
    'mousedown',
    (event) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('.terminal-tab__close') || target.classList.contains('terminal-tab__close')) {
        void window.termif.app.log('info', 'ui:mousedown', `[CLOSE_TAB_BTN] (x:${event.clientX}, y:${event.clientY})`)
      }
    },
    true,
  )

  document.addEventListener(
    'keydown',
    (event) => {
      const mod = [
        event.metaKey ? 'Cmd' : '',
        event.ctrlKey ? 'Ctrl' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
      ]
        .filter(Boolean)
        .join('+')
      const keyStr = mod ? `${mod}+${event.key}` : event.key
      // Only log hotkeys or navigation keys
      if (mod || ['Escape', 'Enter', 'Tab', 'F1', 'F2', 'F12'].includes(event.key)) {
        void window.termif.app.log('info', 'ui:keydown', keyStr)
      }
    },
    true,
  )

  void window.termif.app.log('info', 'renderer:boot', 'Termif Renderer Telemetry & Click Logging Active')
}

initGlobalActionLogging()

async function main(): Promise<void> {
  const app = await boot()
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  root.render(
    <React.StrictMode>
      <MainLayout app={app} />
    </React.StrictMode>,
  )
}

main().catch((error) => {
  console.error('Fatal boot error:', error)
})
