import { describe, expect, it } from 'vitest'
import { backend, bootApp, flush, futureIso, sampleUsage } from './backend'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

const TEAM_USAGE = {
  five_hour: { utilization: 12, resets_at: futureIso(3) },
  seven_day: { utilization: 93, resets_at: futureIso(48) },
}

// What a dataless org (e.g. enterprise orgs without per-seat stats) returns.
const NO_USAGE = { five_hour: null, seven_day: null }

function bootTwoOrgs() {
  const b = backend()
  b.state.credentials = { sessionKey: 'sk', organizationId: 'org-ent' }
  b.state.usageData = sampleUsage()
  b.state.organizations = [
    { id: 'org-ent', name: 'Enterprise Org', ravenType: 'enterprise' },
    { id: 'org-team', name: 'Team Org', ravenType: 'team' },
  ]
  b.state.orgUsage = { 'org-team': TEAM_USAGE }
  return bootApp()
}

describe('additional Claude organizations', () => {
  it('renders a section per additional org with usage bars and timers', async () => {
    await bootTwoOrgs()
    await flush(60)

    const section = el('extraOrgsSection')
    expect(section.textContent).toContain('Team Org')
    expect(section.textContent).toContain('Current Session')
    expect(section.textContent).toContain('Weekly Limit')
    expect(section.textContent).toContain('12%')
    expect(section.textContent).toContain('93%')
    // 93% weekly → danger styling
    expect(section.querySelector('.progress-fill.weekly.danger')).not.toBeNull()
    // Countdown timers populated from resets_at
    const timers = section.querySelectorAll('.timer-text')
    expect(timers).toHaveLength(2)
    expect(timers[0].textContent).not.toBe('--:--')
  })

  it('escapes hostile resets_at values instead of injecting markup', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org-ent' }
    b.state.usageData = sampleUsage()
    b.state.organizations = [
      { id: 'org-ent', name: 'Enterprise Org' },
      { id: 'org-evil', name: 'Evil Org' },
    ]
    b.state.orgUsage = {
      'org-evil': {
        five_hour: { utilization: 1, resets_at: '"><img id="pwned" src=x>' },
        seven_day: { utilization: 1, resets_at: futureIso(48) },
      },
    }
    await bootApp()
    await flush(60)

    const section = el('extraOrgsSection')
    expect(section.querySelector('#pwned')).toBeNull()
    expect(section.querySelector('img')).toBeNull()
    // The raw value round-trips through the attribute unharmed
    const timer = section.querySelector<HTMLDivElement>('.timer-text')
    expect(timer?.dataset.resets).toBe('"><img id="pwned" src=x>')
  })

  it('includes additional orgs in tray usage updates', async () => {
    const b = await bootTwoOrgs()
    await flush(60)
    const trayCalls = b.callsFor('update_tray_usage') as Array<{ stats: Record<string, unknown> }>
    const last = trayCalls[trayCalls.length - 1].stats
    expect(last.session).toBe(42)
    expect(last.orgs).toEqual([{ name: 'Team Org', session: 12, weekly: 93 }])
  })

  it('labels the primary section with its org name when several orgs exist', async () => {
    await bootTwoOrgs()
    await flush(60)
    const subtitle = document.querySelector('.claude-divider .service-divider-subtitle')
    expect(subtitle?.textContent).toBe('Enterprise Org')
  })

  it('renders nothing extra for single-org accounts', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org-only' }
    b.state.usageData = sampleUsage()
    b.state.organizations = [{ id: 'org-only', name: 'Solo Org' }]
    await bootApp()
    await flush(60)

    expect(el('extraOrgsSection').innerHTML).toBe('')
    // Single org keeps the generic subtitle
    const subtitle = document.querySelector('.claude-divider .service-divider-subtitle')
    expect(subtitle?.textContent).toBe('Anthropic Usage')
  })

  it('omits orgs whose usage fetch fails without breaking the widget', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org-ent' }
    b.state.usageData = sampleUsage()
    b.state.organizations = [
      { id: 'org-ent', name: 'Enterprise Org' },
      { id: 'org-broken', name: 'Broken Org' },
      { id: 'org-team', name: 'Team Org' },
    ]
    b.state.orgUsage = { 'org-team': TEAM_USAGE } // org-broken has no usage → fetch throws
    await bootApp()
    await flush(60)

    const section = el('extraOrgsSection')
    expect(section.textContent).toContain('Team Org')
    expect(section.textContent).not.toContain('Broken Org')
    expect(el('mainContent').style.display).toBe('block')
  })

  it('keeps working when the org list itself cannot be fetched', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org-ent' }
    b.state.usageData = sampleUsage()
    b.state.errors.get_organizations = 'CloudflareBlocked: Just a moment'
    await bootApp()
    await flush(60)

    expect(el('mainContent').style.display).toBe('block')
    expect(el('sessionPercentage').textContent).toBe('42%')
    expect(el('extraOrgsSection').innerHTML).toBe('')
  })

  it('grows the window to fit additional org sections', async () => {
    const b = await bootTwoOrgs()
    await flush(60)
    const resizes = b.callsFor('resize_window') as Array<{ height: number }>
    const finalHeight = resizes[resizes.length - 1].height
    // collapsed base + sonnet row + one extra org section (92px) at minimum
    expect(finalHeight).toBeGreaterThanOrEqual(164 + 92)
  })

  it('clears org sections on logout', async () => {
    await bootTwoOrgs()
    await flush(60)
    expect(el('extraOrgsSection').innerHTML).not.toBe('')

    el('settingsBtn').click()
    await flush(20)
    el('logoutBtn').click()
    await flush(30)
    expect(el('extraOrgsSection').innerHTML).toBe('')
  })

  it('promotes an org with usage data when the primary reports none', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org-ent' }
    b.state.usageData = NO_USAGE
    b.state.organizations = [
      { id: 'org-ent', name: 'Enterprise Org', ravenType: 'enterprise' },
      { id: 'org-team', name: 'Team Org', ravenType: 'team' },
    ]
    b.state.orgUsage = { 'org-ent': NO_USAGE, 'org-team': TEAM_USAGE }
    await bootApp()
    await flush(60)

    // Credentials switch (and persist) to the org that has data
    expect(b.state.credentials.organizationId).toBe('org-team')
    // The widget leaves the "no usage yet" screen and shows that org's stats
    expect(el('noUsageContainer').style.display).toBe('none')
    expect(el('mainContent').style.display).toBe('block')
    expect(el('sessionPercentage').textContent).toBe('12%')
    const subtitle = document.querySelector('.claude-divider .service-divider-subtitle')
    expect(subtitle?.textContent).toBe('Team Org')
    // The demoted org becomes a secondary section
    expect(el('extraOrgsSection').textContent).toContain('Enterprise Org')
  })

  it('does not record zero history entries while the primary org has no data', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org-ent' }
    b.state.usageData = NO_USAGE
    b.state.organizations = [
      { id: 'org-ent', name: 'Enterprise Org' },
      { id: 'org-team', name: 'Team Org' },
    ]
    b.state.orgUsage = { 'org-team': TEAM_USAGE }
    await bootApp()
    await flush(60)

    const saves = b.callsFor('save_usage_history_entry') as Array<{
      entry: { session: number; weekly: number }
    }>
    expect(saves.length).toBeGreaterThan(0)
    for (const { entry } of saves) {
      expect(entry.session).toBe(12)
      expect(entry.weekly).toBe(93)
    }
  })

  it('stays on the no-usage screen when no org reports usage', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org-ent' }
    b.state.usageData = NO_USAGE
    b.state.organizations = [
      { id: 'org-ent', name: 'Enterprise Org' },
      { id: 'org-b', name: 'B Org' },
    ]
    b.state.orgUsage = { 'org-b': NO_USAGE }
    await bootApp()
    await flush(60)

    expect(b.state.credentials.organizationId).toBe('org-ent')
    expect(el('noUsageContainer').style.display).toBe('flex')
    expect(b.callsFor('save_usage_history_entry')).toHaveLength(0)
  })

  it('escapes org names when rendering', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org-ent' }
    b.state.usageData = sampleUsage()
    b.state.organizations = [
      { id: 'org-ent', name: 'Enterprise Org' },
      { id: 'org-xss', name: '<img src=x onerror=alert(1)>' },
    ]
    b.state.orgUsage = { 'org-xss': TEAM_USAGE }
    await bootApp()
    await flush(60)

    expect(el('extraOrgsSection').querySelector('img')).toBeNull()
    expect(el('extraOrgsSection').textContent).toContain('<img')
  })
})
