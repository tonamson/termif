import fs from 'node:fs'
import path from 'node:path'

let logFile: string | null = null

function rotateIfNeeded(): void {
  if (logFile === null) return
  try {
    const stat = fs.statSync(logFile)
    if (stat.size > 5 * 1024 * 1024) {
      const rotated = `${logFile}.${Date.now()}`
      fs.renameSync(logFile, rotated)
      // keep last 5 rotated files
      const dir = path.dirname(logFile)
      const base = path.basename(logFile)
      const files = fs.readdirSync(dir).filter((f) => f.startsWith(base + '.')).sort().reverse()
      for (const f of files.slice(5)) fs.unlinkSync(path.join(dir, f))
    }
  } catch {
    // first run, no file yet
  }
}

export function initLogger(userData: string): string {
  const dir = path.join(userData, 'logs')
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'termif.log')
  rotateIfNeeded()
  writeLog('info', 'app', `logger started at ${logFile}`)
  // capture uncaught
  process.on('uncaughtException', (e) => writeLog('error', 'uncaught', `${e.message}\n${e.stack ?? ''}`))
  process.on('unhandledRejection', (r) => writeLog('error', 'unhandled', String(r)))
  return logFile
}

export function writeLog(level: string, scope: string, message: string): void {
  if (logFile === null) return
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${message}\n`
  try {
    fs.appendFileSync(logFile, line)
  } catch {
    // disk full or permission — ignore, don't crash app
  }
  // also mirror to console for dev
  if (level === 'error') console.error(line.trim())
  else if (level === 'warn') console.warn(line.trim())
  else console.log(line.trim())
}

export function getLogPath(): string | null {
  return logFile
}
