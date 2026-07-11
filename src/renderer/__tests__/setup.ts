/**
 * Test environment setup: mocks the @tauri-apps/api modules to dispatch into
 * the fake backend (backend.ts), loads the real index.html markup, and stubs
 * the Canvas 2D API that happy-dom lacks.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, vi } from 'vitest'
import { createBackend, type Backend } from './backend'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    ((globalThis as Record<string, unknown>).__backend as Backend).invoke(cmd, args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => {
    ;((globalThis as Record<string, unknown>).__backend as Backend).listeners[event] = handler
    return Promise.resolve(() => {})
  },
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ((globalThis as Record<string, unknown>).__backend as Backend).appWindow,
}))

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8')
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
const BODY_HTML = (bodyMatch ? bodyMatch[1] : '').replace(/<script[\s\S]*?<\/script>/gi, '')

function createFakeContext(): CanvasRenderingContext2D {
  const explicit: Record<PropertyKey, unknown> = {
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }
  return new Proxy(explicit, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return () => undefined
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
  vi.resetModules()
  document.head.innerHTML = ''
  document.body.innerHTML = BODY_HTML
  document.body.className = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-background-hue')
  ;(globalThis as Record<string, unknown>).__backend = createBackend()
  // happy-dom has no canvas implementation
  ;(HTMLCanvasElement.prototype as { getContext: unknown }).getContext = () => createFakeContext()
})
