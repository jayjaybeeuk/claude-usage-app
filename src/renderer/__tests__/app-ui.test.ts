import { describe, expect, it } from 'vitest'
import { backend, bootApp, flush, sampleUsage } from './backend'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

function bootWithUsage() {
  const b = backend()
  b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
  b.state.usageData = sampleUsage()
  b.state.history = [
    { timestamp: Date.now() - 2 * 24 * 3_600_000, session: 10, weekly: 20, sonnet: 5 },
    { timestamp: Date.now() - 1 * 24 * 3_600_000, session: 30, weekly: 40, sonnet: 15, opus: 3 },
    { timestamp: Date.now(), session: 42, weekly: 80, sonnet: 91 },
  ]
  return bootApp()
}

describe('widget UI interactions', () => {
  it('toggles the history graph and renders the chart', async () => {
    const b = await bootWithUsage()
    await flush(40)
    el('graphToggleBtn').click()
    await flush(40)
    expect(el('graphSection').style.display).toBe('block')
    expect(el('graphToggleBtn').classList.contains('active')).toBe(true)
    expect(b.callsFor('get_usage_history').length).toBeGreaterThan(0)

    el('graphToggleBtn').click()
    await flush(10)
    expect(el('graphSection').style.display).toBe('none')
  })

  it('toggles the pie chart section', async () => {
    await bootWithUsage()
    await flush(40)
    el('pieToggleBtn').click()
    await flush(30)
    expect(el('pieSection').style.display).toBe('block')
    el('pieToggleBtn').click()
    await flush(10)
    expect(el('pieSection').style.display).toBe('none')
  })

  it('opens and closes settings, restoring the previous height', async () => {
    const b = await bootWithUsage()
    await flush(40)
    el('settingsBtn').click()
    await flush(40)
    expect(el('settingsOverlay').style.display).toBe('flex')

    el('closeSettingsBtn').click()
    await flush(10)
    expect(el('settingsOverlay').style.display).toBe('none')
    const resizes = b.callsFor('resize_window') as Array<{ height: number }>
    expect(resizes.length).toBeGreaterThan(0)
  })

  it('updates the refresh interval from the slider (clamped by the backend)', async () => {
    const b = await bootWithUsage()
    await flush(40)
    const slider = el('refreshIntervalSlider') as HTMLInputElement

    slider.value = '12'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    expect(el('refreshIntervalValue').textContent).toBe('12 minutes')

    slider.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(20)
    expect(b.callsFor('set_refresh_interval')).toEqual([{ minutes: 12 }])
    expect(b.state.refreshInterval).toBe(12)

    slider.value = '1'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    expect(el('refreshIntervalValue').textContent).toBe('1 minute')
  })

  it('applies theme and background hue selections to the document', async () => {
    const b = await bootWithUsage()
    await flush(40)
    const theme = el('themeDropdown') as HTMLSelectElement
    theme.value = 'green'
    theme.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(20)
    expect(document.documentElement.getAttribute('data-theme')).toBe('green')
    expect(b.state.theme).toBe('green')

    const hue = el('backgroundHueDropdown') as HTMLSelectElement
    hue.value = 'orange'
    hue.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(20)
    expect(document.documentElement.getAttribute('data-background-hue')).toBe('orange')

    hue.value = 'match'
    hue.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(20)
    expect(document.documentElement.hasAttribute('data-background-hue')).toBe(false)
  })

  it('loads persisted theme and refresh interval at startup', async () => {
    const b = backend()
    b.state.theme = 'metallic'
    b.state.backgroundHue = 'lilac'
    b.state.refreshInterval = 9
    await bootApp()
    expect(document.documentElement.getAttribute('data-theme')).toBe('metallic')
    expect(document.documentElement.getAttribute('data-background-hue')).toBe('lilac')
    expect(el('refreshIntervalValue').textContent).toBe('9 minutes')
    expect((el('themeDropdown') as HTMLSelectElement).value).toBe('metallic')
  })

  it('shows the auto-start toggle when supported and persists changes', async () => {
    const b = await bootWithUsage()
    await flush(40)
    expect(el('autoStartSection').style.display).toBe('block')
    const toggle = el('autoStartToggle') as HTMLInputElement
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(20)
    expect(b.state.autoStart).toBe(true)
  })

  it('hides the auto-start section on unsupported platforms', async () => {
    const b = backend()
    b.state.autoStartSupported = false
    await bootApp()
    expect(el('autoStartSection').style.display).toBe('none')
  })

  it('logs out from settings: deletes credentials and shows login', async () => {
    const b = await bootWithUsage()
    await flush(40)
    el('settingsBtn').click()
    await flush(20)
    el('logoutBtn').click()
    await flush(30)

    expect(b.callsFor('delete_credentials')).toHaveLength(1)
    expect(b.state.credentials.sessionKey).toBeNull()
    expect(el('loginContainer').style.display).toBe('flex')
    expect(el('settingsOverlay').style.display).toBe('none')
  })

  it('clears usage history from settings', async () => {
    const b = await bootWithUsage()
    await flush(40)
    el('clearHistoryBtn').click()
    await flush(20)
    expect(b.state.history).toHaveLength(0)
    expect(el('clearHistoryBtn').textContent).toBe('Cleared!')
  })

  it('opens donation links externally', async () => {
    const b = await bootWithUsage()
    await flush(40)
    el('coffeeBtn').click()
    el('coffeeBtnAlt').click()
    await flush(10)
    const urls = (b.callsFor('open_external') as Array<{ url: string }>).map((c) => c.url)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('paypal.me')
  })
})
