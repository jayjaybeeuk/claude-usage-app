# Phase 1: Offline Mode - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Widget gracefully handles network unavailability by displaying cached usage data with a freshness indicator. Persists cache to disk so data survives app restarts. Auto-resumes live fetching when connectivity returns. Creating/modifying the underlying API fetch logic or adding new data sources are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Status bar — offline state
- When offline and showing cached data: status bar reads "Offline · Last updated X minutes ago"
- Existing status bar UI is reused — offline mode only changes the text content
- When connectivity returns and live data is fetched: status bar reverts to existing "Refreshed just now" / "Refreshed X minutes ago" behavior (no changes needed there)

### Network recovery
- Silent transition — no animation, no "Connected" flash
- Widget fetches live data in the background when network returns; status bar updates naturally as part of the normal refresh cycle

### Cold start with no cache
- If the widget launches with no network AND no cached data: show the existing login/error screen unchanged
- Offline mode only activates when there IS cached data to display — don't show empty progress bars at 0%

### Cache staleness
- No age limit — show whatever is cached regardless of how old it is
- The "Last updated X ago" timestamp is sufficient for the user to judge freshness themselves

### Claude's Discretion
- Cache persistence mechanism (electron-store is already in use, natural fit)
- Network detection approach (fetch failure vs. OS network events)
- Retry interval for resuming live fetching when network returns
- Exact data structure persisted to cache
- Whether to differentiate "no network" vs "API error" in offline detection

</decisions>

<specifics>
## Specific Ideas

- The existing `statusText` element and "Refreshed X minutes ago" logic (app.ts:843–856) is the hook point for the offline indicator — extend it rather than adding new UI
- `lastRefreshTime` is currently in-memory only; persisting this (along with usage data) to electron-store is the core cache work

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-offline-mode*
*Context gathered: 2026-02-20*
