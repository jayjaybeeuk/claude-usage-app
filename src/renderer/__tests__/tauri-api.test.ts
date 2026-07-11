import { describe, expect, it } from 'vitest'
import { backend, flush } from './backend'

async function loadShim() {
  await import('../tauri-api')
  return window.electronAPI
}

describe('tauri-api shim', () => {
  it('installs window.electronAPI with a platform string', async () => {
    const api = await loadShim()
    expect(api).toBeDefined()
    expect(['darwin', 'win32', 'linux']).toContain(api.platform)
    expect(await api.getPlatform()).toBe('darwin')
  })

  it('maps credential methods to the right commands and argument names', async () => {
    const api = await loadShim()
    const b = backend()

    expect(await api.getCredentials()).toEqual({ sessionKey: null, organizationId: null })
    await api.saveCredentials({ sessionKey: 'sk-test', organizationId: 'org-1' })
    expect(b.callsFor('save_credentials')).toEqual([{ sessionKey: 'sk-test', organizationId: 'org-1' }])
    expect(b.state.credentials).toEqual({ sessionKey: 'sk-test', organizationId: 'org-1' })

    await api.saveCredentials({ sessionKey: 'sk-2' })
    expect(b.callsFor('save_credentials')[1]).toEqual({ sessionKey: 'sk-2', organizationId: null })

    await api.deleteCredentials()
    expect(b.state.credentials.sessionKey).toBeNull()
  })

  it('wraps string command rejections into Error objects', async () => {
    const api = await loadShim()
    backend().state.usageError = 'SessionExpired'
    const err = await api.fetchUsageData().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('SessionExpired')
  })

  it('round-trips settings commands', async () => {
    const api = await loadShim()
    expect(await api.getRefreshIntervalMinutes()).toBe(5)
    expect(await api.setRefreshIntervalMinutes(90)).toBe(20)
    expect(await api.getTheme()).toBe('purple')
    expect(await api.setTheme('green')).toBe('green')
    expect(await api.getBackgroundHue()).toBe('match')
    expect(await api.setBackgroundHue('orange')).toBe('orange')
    expect(await api.isAutoStartSupported()).toBe(true)
    expect(await api.getAutoStart()).toBe(false)
    expect(await api.setAutoStart(true)).toBe(true)
  })

  it('covers window, history, codex, and fire-and-forget helpers', async () => {
    const api = await loadShim()
    const b = backend()

    api.minimizeWindow()
    api.closeWindow()
    api.resizeWindow(300)
    api.openExternal('https://example.com')
    api.updateTrayUsage({ session: 1, weekly: 2, sonnet: 3 })
    await flush(5)
    expect(b.callsFor('minimize_window')).toHaveLength(1)
    expect(b.callsFor('close_window')).toHaveLength(1)
    expect(b.callsFor('resize_window')).toEqual([{ height: 300 }])
    expect(b.callsFor('open_external')).toEqual([{ url: 'https://example.com' }])
    expect(b.callsFor('update_tray_usage')).toEqual([{ stats: { session: 1, weekly: 2, sonnet: 3 } }])

    expect(await api.getWindowPosition()).toEqual({ x: 10, y: 20, width: 480, height: 174 })
    expect(await api.setWindowPosition({ x: 5, y: 6 })).toBe(true)

    await api.saveUsageHistoryEntry({ timestamp: 1, session: 2, weekly: 3, sonnet: 4 })
    expect(await api.getUsageHistory()).toHaveLength(1)
    await api.clearUsageHistory()
    expect(await api.getUsageHistory()).toHaveLength(0)

    expect(await api.getCodexCredentials()).toEqual({ accessToken: null })
    await api.saveCodexCredentials({ accessToken: 'tok', cookieName: 'c' })
    expect(b.callsFor('save_codex_credentials')).toEqual([{ accessToken: 'tok', cookieName: 'c' }])
    await api.deleteCodexCredentials()
    expect(b.state.codexCredentials.accessToken).toBeNull()
    expect(await api.getCachedUsage()).toBeNull()
    expect(await api.getCachedCodexUsage()).toBeNull()
    expect(await api.getOrganizations()).toEqual([])
    b.state.orgUsage = { 'org-x': { five_hour: { utilization: 1 } } }
    expect(await api.fetchUsageDataForOrg('org-x')).toEqual({ five_hour: { utilization: 1 } })
    expect(b.callsFor('fetch_usage_for_org')).toEqual([{ organizationId: 'org-x' }])
    expect(await api.detectSessionKey()).toMatchObject({ success: false })
    expect(await api.detectCodexToken()).toMatchObject({ success: false })
    expect(await api.validateSessionKey('x')).toMatchObject({ success: false })
  })

  it('delivers backend events to registered listeners', async () => {
    const api = await loadShim()
    const b = backend()
    const seen: string[] = []
    api.onRefreshUsage(() => seen.push('refresh'))
    api.onSessionExpired(() => seen.push('expired'))
    api.onCodexSessionExpired(() => seen.push('codex-expired'))
    api.onDebugLog((label) => seen.push(`debug:${label}`))
    await flush(5)

    b.emit('refresh-usage')
    b.emit('session-expired')
    b.emit('codex-session-expired')
    b.emit('debug-log', { label: 'hi', data: { a: 1 } })
    expect(seen).toEqual(['refresh', 'expired', 'codex-expired', 'debug:hi'])
  })

  it('starts window dragging from the title bar but not from controls', async () => {
    await loadShim()
    const b = backend()
    const title = document.querySelector('.title-bar .title') as HTMLElement
    title.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flush(5)
    expect(b.appWindow.startDragging).toHaveBeenCalled()

    b.appWindow.startDragging.mockClear()
    const controlBtn = document.querySelector('.title-bar .controls button') as HTMLElement
    controlBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    const elsewhere = document.querySelector('#mainContent') as HTMLElement
    elsewhere.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flush(5)
    expect(b.appWindow.startDragging).not.toHaveBeenCalled()
  })
})
