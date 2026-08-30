import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

let logFile: string | null = null

export function initLogger(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'termif.log')
  // Rotate if > 10MB
  try {
    const stat = fs.statSync(logFile)
    if (stat.size > 10 * 1024 * 1024) {
      fs.renameSync(logFile, path.join(dir, 'termif.old.log'))
    }
  } catch {
    // file doesn't exist yet
  }
  writeLog('info', 'app', `logger started at ${logFile}`)
  return logFile
}

export function getLogPath(): string | null {
  return logFile
}

export function writeLog(level: string, scope: string, message: string): void {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${message}\n`
  // Console output
  if (level === 'error') {
    console.error(line.trimEnd())
  } else {
    console.log(line.trimEnd())
  }
  // File output
  if (logFile !== null) {
    try {
      fs.appendFileSync(logFile, line)
    } catch {
      // Best effort; can't log about logging failure
    }
  }
}
