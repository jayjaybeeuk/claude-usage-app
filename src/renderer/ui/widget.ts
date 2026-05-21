import { elements } from './elements'

export const WIDGET_HEIGHT_COLLAPSED = 164 // 140 base + 24 status bar
export const WIDGET_ROW_HEIGHT = 30
export const GRAPH_HEIGHT = 170
export const PIE_HEIGHT = 162
export const SONNET_ROW_HEIGHT = 30

export const CODEX_SECTION_BASE_HEIGHT = 28 + 32 + 32
export const CODEX_LOGIN_HEIGHT = CODEX_SECTION_BASE_HEIGHT + 20
export const CODEX_GRAPH_HEIGHT = 170
export const CODEX_PIE_HEIGHT = 162
export const CODEX_STATUS_HEIGHT = 34

export const COPILOT_SECTION_BASE_HEIGHT = 28 + 32
export const COPILOT_STATUS_HEIGHT = 34
export const COPILOT_LOGIN_HEIGHT = COPILOT_SECTION_BASE_HEIGHT + 20

export const GEMINI_SECTION_BASE_HEIGHT = 28 + 32
export const GEMINI_STATUS_HEIGHT = 34
export const GEMINI_LOGIN_HEIGHT = GEMINI_SECTION_BASE_HEIGHT + 20

export const WIDGET_HEIGHT_BUFFER = 8

let lastNonSettingsHeight = WIDGET_HEIGHT_COLLAPSED

export interface WidgetState {
  isSettingsOpen: boolean
  isGraphVisible: boolean
  isPieVisible: boolean
  isExpanded: boolean
  codexHasData: boolean
  isCodexGraphVisible: boolean
  isCodexPieVisible: boolean
  copilotHasData: boolean
  geminiHasData: boolean
}

export function resizeForSettings(): void {
  const contentHeight = Math.ceil(elements.settingsContent.getBoundingClientRect().height)
  const height = Math.max(WIDGET_HEIGHT_COLLAPSED, contentHeight + 140)
  window.electronAPI.resizeWindow(height)
}

export function restoreNonSettingsHeight(): void {
  window.electronAPI.resizeWindow(lastNonSettingsHeight)
}

export function resizeWidget(state: WidgetState): void {
  if (elements.mainContent.style.display === 'none') {
    lastNonSettingsHeight = WIDGET_HEIGHT_COLLAPSED
    if (!state.isSettingsOpen) {
      window.electronAPI.resizeWindow(WIDGET_HEIGHT_COLLAPSED)
    }
    return
  }

  let height = WIDGET_HEIGHT_COLLAPSED

  // Add Sonnet row if visible
  const sonnetVisible = elements.sonnetRow.style.display !== 'none'
  if (sonnetVisible) {
    height += SONNET_ROW_HEIGHT
  }

  // Add graph if visible
  if (state.isGraphVisible) {
    height += GRAPH_HEIGHT
  }

  // Add pie chart if visible
  if (state.isPieVisible) {
    height += PIE_HEIGHT
  }

  // Add expanded extra rows
  const extraCount = elements.extraRows.children.length
  if (state.isExpanded && extraCount > 0) {
    height += 12 + extraCount * WIDGET_ROW_HEIGHT
  }

  // Codex section is always visible on the same page
  if (state.codexHasData) {
    height += CODEX_SECTION_BASE_HEIGHT + CODEX_STATUS_HEIGHT
    if (state.isCodexGraphVisible) height += CODEX_GRAPH_HEIGHT
    if (state.isCodexPieVisible) height += CODEX_PIE_HEIGHT
  } else {
    height += CODEX_LOGIN_HEIGHT
  }

  // Copilot section
  if (state.copilotHasData) {
    height += COPILOT_SECTION_BASE_HEIGHT + COPILOT_STATUS_HEIGHT
  } else {
    height += COPILOT_LOGIN_HEIGHT
  }

  // Gemini section
  if (state.geminiHasData) {
    height += GEMINI_SECTION_BASE_HEIGHT + GEMINI_STATUS_HEIGHT
  } else {
    height += GEMINI_LOGIN_HEIGHT
  }

  // Ensure window is never smaller than actual rendered content (and can still retract).
  const titleBarHeight = Math.ceil(elements.titleBar.getBoundingClientRect().height)
  const mainContentHeight = Math.ceil(elements.mainContent.scrollHeight)
  const measuredHeight = titleBarHeight + mainContentHeight + WIDGET_HEIGHT_BUFFER
  height = Math.max(height + WIDGET_HEIGHT_BUFFER, measuredHeight)

  lastNonSettingsHeight = height
  if (!state.isSettingsOpen) {
    window.electronAPI.resizeWindow(height)
  }
}