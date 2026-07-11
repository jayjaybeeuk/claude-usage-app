import { describe, expect, it } from 'vitest'
import { backend, bootApp, flush, sampleCodexUsage, sampleUsage } from './backend'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const click = (id: string): void => el(id).click()

describe('app startup and login flows', () => {
  it('shows the login screen when no credentials are stored', async () => {
    const b = await bootApp()
    expect(el('loginContainer').style.display).toBe('flex')
    expect(el('mainContent').style.display).toBe('none')
    expect(document.body.className).toMatch(/platform-(darwin|win32|linux)/)
    expect(b.callsFor('get_credentials').length).toBeGreaterThan(0)
  })

  it('boots straight into main content with stored credentials and usage', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await bootApp()
    await flush(50)

    expect(el('mainContent').style.display).toBe('block')
    expect(el('loginContainer').style.display).toBe('none')
    expect(el('sessionPercentage').textContent).toBe('42%')
    expect(el('weeklyPercentage').textContent).toBe('80%')
    // 80% weekly → warning class; 91% sonnet → danger class
    expect(el('weeklyProgress').classList.contains('warning')).toBe(true)
    expect(el('sonnetProgress').classList.contains('danger')).toBe(true)
    expect(el('sonnetRow').style.display).not.toBe('none')
    // History entry recorded and tray updated
    expect(b.state.history.length).toBeGreaterThan(0)
    expect(b.callsFor('update_tray_usage').length).toBeGreaterThan(0)
    expect(el('statusText').textContent).toBe('Refreshed just now')
  })

  it('navigates between login steps and opens claude.ai externally', async () => {
    const b = await bootApp()
    click('nextStepBtn')
    expect(el('loginStep2').style.display).toBe('block')
    click('backStepBtn')
    expect(el('loginStep1').style.display).toBe('flex')

    el('openBrowserLink').click()
    await flush(5)
    expect(b.callsFor('open_external')).toEqual([{ url: 'https://claude.ai' }])
  })

  it('handles manual session key connect: empty, invalid, then valid', async () => {
    const b = await bootApp()
    const input = el('sessionKeyInput') as HTMLInputElement

    click('connectBtn')
    expect(el('sessionKeyError').textContent).toBe('Please paste your session key')

    input.value = 'bad-key'
    b.state.validateResult = { success: false, error: 'No organization found' }
    click('connectBtn')
    await flush(40)
    expect(el('sessionKeyError').textContent).toBe('No organization found')

    input.value = 'sk-good'
    b.state.validateResult = { success: true, organizationId: 'org-9' }
    b.state.usageData = sampleUsage()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    click('connectBtn')
    await flush(60)

    expect(b.state.credentials).toEqual({ sessionKey: 'sk-good', organizationId: 'org-9' })
    expect(el('mainContent').style.display).toBe('block')
    expect(el('codexSessionPercentage').textContent).toBe('33%')
  })

  it('handles connect rejection as a connection failure', async () => {
    const b = await bootApp()
    ;(el('sessionKeyInput') as HTMLInputElement).value = 'sk-x'
    b.state.errors.validate_session_key = 'CloudflareBlocked: Just a moment'
    click('connectBtn')
    await flush(40)
    expect(el('sessionKeyError').textContent).toBe('Connection failed. Check your key.')
  })

  it('handles browser auto-detect login success', async () => {
    const b = await bootApp()
    b.state.detectResult = { success: true, sessionKey: 'sk-detected' }
    b.state.validateResult = { success: true, organizationId: 'org-a' }
    b.state.usageData = sampleUsage()
    click('autoDetectBtn')
    await flush(60)

    expect(b.state.credentials).toEqual({ sessionKey: 'sk-detected', organizationId: 'org-a' })
    expect(el('mainContent').style.display).toBe('block')
    expect((el('autoDetectBtn') as HTMLButtonElement).disabled).toBe(false)
  })

  it('reports auto-detect failures and invalid captured sessions', async () => {
    const b = await bootApp()
    b.state.detectResult = { success: false, error: 'Login window closed' }
    click('autoDetectBtn')
    await flush(40)
    expect(el('autoDetectError').textContent).toBe('Login window closed')

    b.state.detectResult = { success: true, sessionKey: 'sk-stale' }
    b.state.validateResult = { success: false, error: 'Invalid' }
    click('autoDetectBtn')
    await flush(40)
    expect(el('autoDetectError').textContent).toBe('Session invalid. Try again or use Manual →')
  })
})
