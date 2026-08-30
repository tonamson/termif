import React from 'react'
import ReactDOM from 'react-dom/client'
import { boot } from './state/boot.js'
import { MainLayout } from './views/MainLayout.js'
import './styles/app.css'

// Comprehensive Renderer Action & Error Logger
function initGlobalActionLogging() {
  if (typeof window === 'undefined' || !window.termif?.app?.log) return

  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    originalLog(...args)
    void window.termif.app.log('info', 'renderer:console', args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
  }

  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    void window.termif.app.log('warn', 'renderer:console', args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
  }

  console.error = (...args: unknown[]) => {
    originalError(...args)
    void window.termif.app.log('error', 'renderer:console', args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
  }

  window.addEventListener('error', (event) => {
    void window.termif.app.log('error', 'renderer:unhandled', `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`)
  })

  window.addEventListener('unhandledrejection', (event) => {
    void window.termif.app.log('error', 'renderer:unhandledRejection', String(event.reason?.stack || event.reason))
  })

  // Global user interaction capture (Clicks and Keydowns)
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    const tag = target.tagName.toLowerCase()
    const label = target.getAttribute('aria-label') || target.innerText?.slice(0, 30) || target.className || tag
    void window.termif.app.log('debug', 'ui:click', `<${tag}> [${label}]`)
  }, true)

  void window.termif.app.log('info', 'renderer:boot', 'Termif Renderer Initialized with Full Telemetry Logging')
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
