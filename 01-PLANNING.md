# Phase 2: Multi-Provider Refactor & Gemini Integration

**Objective:** Refactor the existing monolithic `app.ts` into a multi-provider architecture to support adding Google Gemini usage tracking alongside Claude, Codex, and Copilot.

## Step-by-Step Plan

### Step 1: Shared UI & State Extraction

- [x] Extract shared DOM elements map into `src/renderer/ui/elements.ts`.
- [x] Extract theme utilities (colors, opacity) into `src/renderer/ui/theme.ts`.
- [x] Extract common UI behaviors (window resizing, layout management) into a dedicated UI module.
- [x] _Goal:_ Reduce the line count of `app.ts` and separate generic UI logic from API/provider logic.

### Step 2: Provider Abstraction

- Define an `AIProvider` interface with a standard lifecycle (`init()`, `fetchData()`, `updateUI()`, `renderCharts()`).
- [x] Extract Claude logic into `src/renderer/providers/ClaudeProvider.ts`.
- [x] Extract Codex logic into `src/renderer/providers/CodexProvider.ts`.
- [x] Extract Copilot logic into `src/renderer/providers/CopilotProvider.ts`.
- Update `app.ts` to act as a lightweight orchestrator for these providers.

### Step 3: Main Process & IPC Preparation for Gemini

- [x] Add Gemini usage data structures (`GeminiUsageData`, `CachedGeminiUsageData`) to `ipc-types.ts`.
- [x] Define new IPC channels (`FETCH_GEMINI_USAGE`, `SAVE_GEMINI_CREDENTIALS`, etc.) in `ipc-channels.ts`.
- [x] Implement secure credential storage and API fetching logic for Gemini in `src/main/main.ts`.

### Step 4: Gemini Implementation

- [x] Create `src/renderer/providers/GeminiProvider.ts`.
- [x] Update `index.html` and `styles.css` with Gemini-specific UI elements and CSS variables.
- [x] Add Gemini to the settings panel (API key/session input).
- [x] Wire the new provider into the main `app.ts` orchestrator.
