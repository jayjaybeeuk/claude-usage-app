/**
 * fetch-via-window.ts
 *
 * Fetches JSON from a URL using a hidden BrowserWindow.
 *
 * Why this exists:
 * Claude.ai uses Cloudflare protection and detects Electron's default
 * request headers, blocking standard Node.js fetch/http requests.
 * By loading the URL in a hidden BrowserWindow with a spoofed Chrome
 * User-Agent, we ride on the browser session cookies and bypass
 * Cloudflare's bot detection. This is the simplest reliable approach
 * after the previous cookie-database-reading strategy proved too
 * fragile and OS-specific.
 */
import { BrowserWindow } from 'electron'

interface BlockedSignature {
  pattern: string
  error: string
}

/**
 * Known error signatures returned when Claude.ai blocks or changes behaviour.
 * If the extracted body matches one of these patterns we throw a specific error
 * so callers can react (e.g. prompt re-login).
 */
const BLOCKED_SIGNATURES: BlockedSignature[] = [
  { pattern: 'Just a moment', error: 'CloudflareBlocked' },
  { pattern: 'Enable JavaScript and cookies to continue', error: 'CloudflareChallenge' },
  { pattern: '<html', error: 'UnexpectedHTML' },
]

interface FetchViaWindowOptions {
  timeoutMs?: number
}

export function fetchViaWindow(url: string, { timeoutMs = 30000 }: FetchViaWindowOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    const timeout = setTimeout(() => {
      win.destroy()
      reject(new Error('Request timeout'))
    }, timeoutMs)

    win.webContents.on('did-finish-load', async () => {
      try {
        const bodyText: string = await win.webContents.executeJavaScript(
          'document.body.innerText || document.body.textContent'
        )
        clearTimeout(timeout)
        win.destroy()

        // Detect known block/failure signatures before attempting JSON parse.
        // This provides explicit errors when Claude.ai modifies their API or CSP.
        for (const sig of BLOCKED_SIGNATURES) {
          if (bodyText.includes(sig.pattern)) {
            reject(new Error(`${sig.error}: ${bodyText.substring(0, 200)}`))
            return
          }
        }

        try {
          const data: unknown = JSON.parse(bodyText)
          resolve(data)
        } catch {
          reject(new Error('InvalidJSON: ' + bodyText.substring(0, 200)))
        }
      } catch (err) {
        clearTimeout(timeout)
        win.destroy()
        reject(err)
      }
    })

    win.webContents.on('did-fail-load', (_event: Electron.Event, errorCode: number, errorDescription: string) => {
      clearTimeout(timeout)
      win.destroy()
      reject(new Error(`LoadFailed: ${errorCode} ${errorDescription}`))
    })

    win.loadURL(url)
  })
}
