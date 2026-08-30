export function logToFile(level: string, scope: string, message: string): void {
  try {
    ;(window as unknown as { termif?: { app: { log: (l: string, s: string, m: string) => void } } }).termif?.app.log(level, scope, message)
  } catch {
    // no bridge in tests
  }
}
