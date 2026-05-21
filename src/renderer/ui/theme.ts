import { elements } from './elements'

// Helper to get CSS custom property values
export function getCSSVariable(propertyName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim()
}

export function getThemeColors(): Record<string, string> {
  return {
    claudePrimary: getCSSVariable('--claude-primary'),
    claudeSecondary: getCSSVariable('--claude-secondary'),
    claudeSecondaryLight: getCSSVariable('--claude-secondary-light'),
    codexPrimary: getCSSVariable('--codex-primary'),
    codexSecondary: getCSSVariable('--codex-secondary'),
    codexSecondaryLight: getCSSVariable('--codex-secondary-light'),
    geminiPrimary: getCSSVariable('--gemini-primary'),
    geminiSecondary: getCSSVariable('--gemini-secondary'),
  }
}

// Helper to convert hex color to rgba with alpha
export function hexToRgba(hex: string, alpha: number): string {
  // Remove the hash if it exists
  hex = hex.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

type ThemeChangeCallback = () => void
const themeChangeListeners: ThemeChangeCallback[] = []

export function onThemeChange(cb: ThemeChangeCallback): void {
  themeChangeListeners.push(cb)
}

export function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme)
  requestAnimationFrame(() => {
    themeChangeListeners.forEach((cb) => cb())
  })
}

export function applyBackgroundHue(backgroundHue: string): void {
  if (backgroundHue === 'match') {
    document.documentElement.removeAttribute('data-background-hue')
    return
  }
  document.documentElement.setAttribute('data-background-hue', backgroundHue)
}

export async function loadTheme(): Promise<void> {
  try {
    const savedTheme = await window.electronAPI.getTheme()
    const theme = savedTheme || 'purple'
    elements.themeDropdown.value = theme
    applyTheme(theme)
  } catch (error) {
    console.warn('Failed to load theme, using purple as default:', error)
    applyTheme('purple')
  }
}

export async function loadBackgroundHue(): Promise<void> {
  try {
    const savedBackgroundHue = await window.electronAPI.getBackgroundHue()
    const backgroundHue = savedBackgroundHue || 'match'
    elements.backgroundHueDropdown.value = backgroundHue
    applyBackgroundHue(backgroundHue)
  } catch (error) {
    console.warn('Failed to load background hue, matching theme:', error)
    applyBackgroundHue('match')
  }
}

export async function setTheme(theme: string): Promise<void> {
  try {
    await window.electronAPI.setTheme(theme)
    applyTheme(theme)
  } catch (error) {
    console.error('Failed to save theme:', error)
  }
}

export async function setBackgroundHue(backgroundHue: string): Promise<void> {
  try {
    await window.electronAPI.setBackgroundHue(backgroundHue)
    applyBackgroundHue(backgroundHue)
    applyTheme(elements.themeDropdown.value)
  } catch (error) {
    console.error('Failed to save background hue:', error)
  }
}
