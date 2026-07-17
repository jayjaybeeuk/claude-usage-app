import { describe, expect, it } from 'vitest'
import { backend, bootApp, flush, futureIso, sampleCodexUsage, sampleUsage } from './backend'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

function bootClaudeOnly() {
  const b = backend()
  b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
  b.state.usageData = sampleUsage()
  return bootApp()
}

describe('codex section', () => {
  it('shows the codex login prompt when no token is stored', async () => {
    await bootClaudeOnly()
    await flush(40)
    expect(el('codexLoginContainer').style.display).toBe('block')
    expect(el('codexContent').style.display).toBe('none')
    expect(el('codexStatusText').textContent).toBe('Connect Codex to load usage')
  })

  it('shows codex usage when a token is stored', async () => {
    const b = backend()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    await bootClaudeOnly()
    await flush(60)

    expect(el('codexContent').style.display).toBe('block')
    expect(el('codexSessionPercentage').textContent).toBe('33%')
    expect(el('codexWeeklyPercentage').textContent).toBe('55%')
    expect(el('codexStatusText').textContent).toBe('Refreshed just now')
    // Tray update includes codex stats
    const trayCalls = b.callsFor('update_tray_usage') as Array<{ stats: Record<string, unknown> }>
    expect(trayCalls.some((c) => c.stats.codexSession === 33)).toBe(true)
  })

  it('saves one history entry per refresh cycle, including codex values', async () => {
    const b = backend()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    await bootClaudeOnly()
    await flush(60)

    // One combined entry from boot — not one per service
    const saves = b.callsFor('save_usage_history_entry') as Array<{ entry: Record<string, unknown> }>
    expect(saves).toHaveLength(1)
    expect(saves[0].entry.session).toBe(42)
    expect(saves[0].entry.codexSession).toBe(33)
    expect(saves[0].entry.codexWeekly).toBe(55)

    b.emit('refresh-usage')
    await flush(60)
    expect(b.callsFor('save_usage_history_entry')).toHaveLength(2)
  })

  it('connects via auto-detect and renders usage', async () => {
    const b = await bootClaudeOnly()
    await flush(40)
    b.state.detectCodexResult = { success: true, accessToken: 'tok-x', cookieName: 'sess' }
    b.state.codexUsageData = sampleCodexUsage()
    el('codexAutoDetectBtn').click()
    await flush(60)

    expect(b.callsFor('save_codex_credentials')).toEqual([{ accessToken: 'tok-x', cookieName: 'sess' }])
    expect(el('codexContent').style.display).toBe('block')
    expect((el('codexAutoDetectBtn') as HTMLButtonElement).textContent).toBe('Connect')
  })

  it('shows detection errors from auto-detect', async () => {
    const b = await bootClaudeOnly()
    await flush(40)
    b.state.detectCodexResult = { success: false, error: 'Login window closed' }
    el('codexAutoDetectBtn').click()
    await flush(40)
    expect(el('codexLoginError').textContent).toBe('Login window closed')
  })

  it('supports the manual token entry flow', async () => {
    const b = await bootClaudeOnly()
    await flush(40)
    el('codexManualBtn').click()
    expect(el('codexManualInput').style.display).toBe('block')

    // empty token → validation error
    el('codexSaveBtn').click()
    expect(el('codexTokenError').textContent).toBe('Please paste your Codex token')

    // back button restores buttons
    el('codexBackBtn').click()
    expect(el('codexManualInput').style.display).toBe('none')

    // valid token → usage shown
    el('codexManualBtn').click()
    ;(el('codexTokenInput') as HTMLInputElement).value = 'tok-manual'
    b.state.codexUsageData = sampleCodexUsage()
    el('codexSaveBtn').click()
    await flush(60)
    expect(b.state.codexCredentials.accessToken).toBe('tok-manual')
    expect(el('codexContent').style.display).toBe('block')
  })

  it('returns to codex login when the token is rejected', async () => {
    const b = backend()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageError = 'CodexSessionExpired'
    await bootClaudeOnly()
    await flush(60)
    expect(el('codexLoginContainer').style.display).toBe('block')
    expect(el('codexContent').style.display).toBe('none')
  })

  it('falls back to cached codex data on network errors', async () => {
    const b = backend()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageError = 'CodexUsageFetchFailed:500'
    b.state.cachedCodexUsage = {
      data: { five_hour: { utilization: 71, resets_at: futureIso(1) } },
      timestamp: Date.now() - 5 * 60_000,
    }
    await bootClaudeOnly()
    await flush(60)
    expect(el('codexContent').style.display).toBe('block')
    expect(el('codexSessionPercentage').textContent).toBe('71%')
  })

  it('shows a codex error when fetch fails with no cache', async () => {
    const b = backend()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageError = 'CodexUsageFetchFailed:500'
    await bootClaudeOnly()
    await flush(60)
    expect(el('codexLoginContainer').style.display).toBe('block')
    expect(el('codexLoginError').textContent).toBe('Failed to fetch. Try reconnecting.')
  })

  it('toggles codex graph and pie sections', async () => {
    const b = backend()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    b.state.history = [{ timestamp: Date.now(), session: 1, weekly: 2, sonnet: 0, codexSession: 33, codexWeekly: 55 }]
    await bootClaudeOnly()
    await flush(60)

    el('codexGraphToggleBtn').click()
    await flush(40)
    expect(el('codexGraphSection').style.display).toBe('block')
    el('codexPieToggleBtn').click()
    await flush(40)
    expect(el('codexPieSection').style.display).toBe('block')
    el('codexGraphToggleBtn').click()
    el('codexPieToggleBtn').click()
    await flush(10)
    expect(el('codexGraphSection').style.display).toBe('none')
    expect(el('codexPieSection').style.display).toBe('none')
  })

  it('resets to codex login when codex-session-expired is emitted', async () => {
    const b = backend()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    await bootClaudeOnly()
    await flush(60)
    expect(el('codexContent').style.display).toBe('block')

    b.emit('codex-session-expired')
    await flush(20)
    expect(el('codexLoginContainer').style.display).toBe('block')
  })
})
