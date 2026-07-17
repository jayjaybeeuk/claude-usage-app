/**
 * Chart rendering paths: the Codex history line chart with real data, pie
 * chart empty/placeholder branches, and chart error handling — none of which
 * the flow suites reach.
 */
import { describe, expect, it } from 'vitest'
import { backend, bootApp, flush, futureIso, sampleCodexUsage, sampleUsage } from './backend'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

/** History entries spread across distinct hours so charts have ≥2 points. */
function multiHourHistory(): unknown[] {
  const now = Date.now()
  return [0, 1, 2, 3].map((hoursAgo) => ({
    timestamp: now - hoursAgo * 3_600_000,
    session: 10 + hoursAgo,
    weekly: 20 + hoursAgo,
    sonnet: 5,
    opus: 3,
    cowork: 2,
    codexSession: 30 + hoursAgo,
    codexWeekly: 40 + hoursAgo,
  }))
}

describe('chart rendering', () => {
  it('renders the codex history chart with multi-hour data', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    b.state.history = multiHourHistory()
    await bootApp()
    await flush(60)

    el('codexGraphToggleBtn').click()
    await flush(40)
    expect(el('codexGraphSection').style.display).toBe('block')
    expect(b.callsFor('get_usage_history').length).toBeGreaterThan(0)
  })

  it('re-renders the open codex chart on a successful refresh', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    b.state.history = multiHourHistory()
    await bootApp()
    await flush(60)

    el('codexGraphToggleBtn').click()
    el('codexPieToggleBtn').click()
    await flush(40)
    const reads = b.callsFor('get_usage_history').length

    b.emit('refresh-usage')
    await flush(60)
    expect(b.callsFor('get_usage_history').length).toBeGreaterThan(reads)
    expect(el('codexGraphSection').style.display).toBe('block')
    expect(el('codexPieSection').style.display).toBe('block')
  })

  it('renders the claude history chart with opus and cowork series', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = {
      ...sampleUsage(),
      seven_day_cowork: { utilization: 7, resets_at: futureIso(24) },
    }
    b.state.history = multiHourHistory()
    await bootApp()
    await flush(50)

    el('graphToggleBtn').click()
    await flush(40)
    expect(el('graphSection').style.display).toBe('block')
  })

  it('shows the pie chart no-data message when everything is zero', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    // A reset timestamp keeps the main content visible (utilization is
    // all-zero, so the pie itself still hits its no-data branch)
    b.state.usageData = {
      five_hour: { utilization: 0, resets_at: futureIso(2) },
      seven_day: { utilization: 0 },
    }
    await bootApp()
    await flush(50)

    el('pieToggleBtn').click()
    await flush(30)
    expect(el('pieSection').style.display).toBe('block')
  })

  it('renders the pie placeholder ring when no per-model data exists', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    // Session usage but no seven_day_* model breakdown → placeholder outer
    // ring plus the "No model data from API" legend.
    b.state.usageData = {
      five_hour: { utilization: 40, resets_at: futureIso(2) },
      seven_day: { utilization: 60, resets_at: futureIso(48) },
    }
    await bootApp()
    await flush(50)

    el('pieToggleBtn').click()
    await flush(30)
    expect(el('pieSection').style.display).toBe('block')
    expect(el('pieToggleBtn').classList.contains('active')).toBe(true)
  })

  it('survives history read failures while charts are open', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    await bootApp()
    await flush(60)

    b.state.errors.get_usage_history = 'store unavailable'
    el('graphToggleBtn').click()
    el('codexGraphToggleBtn').click()
    await flush(40)

    // Both chart render calls swallow the rejection and leave sections open.
    expect(el('graphSection').style.display).toBe('block')
    expect(el('codexGraphSection').style.display).toBe('block')
  })
})
