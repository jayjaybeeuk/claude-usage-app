export interface Credentials {
  sessionKey: string | null
  organizationId: string | null
}

export interface SaveCredentialsPayload {
  sessionKey: string
  organizationId?: string
}

export interface WindowPosition {
  x: number
  y: number
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ValidationResult {
  success: boolean
  organizationId?: string
  error?: string
}

export interface DetectSessionResult {
  success: boolean
  sessionKey?: string
  error?: string
}

export interface TrayUsageStats {
  session: number
  weekly: number
  sonnet: number
  codexSession?: number
  codexWeekly?: number
  copilotConsumed?: number
  copilotEntitlement?: number
}

export interface UsageHistoryEntry {
  timestamp: number
  session: number
  weekly: number
  sonnet: number
  opus?: number
  cowork?: number
  oauthApps?: number
  codexSession?: number
  codexWeekly?: number
  copilotConsumed?: number
  copilotEntitlement?: number
}

export interface UsageTimePeriod {
  utilization?: number
  resets_at?: string | null
}

export interface ExtraUsage {
  utilization?: number
  resets_at?: string | null
  used_cents?: number
  limit_cents?: number
  balance_cents?: number
}

export interface UsageData {
  five_hour?: UsageTimePeriod
  seven_day?: UsageTimePeriod
  seven_day_sonnet?: UsageTimePeriod
  seven_day_opus?: UsageTimePeriod
  seven_day_cowork?: UsageTimePeriod
  seven_day_oauth_apps?: UsageTimePeriod
  extra_usage?: ExtraUsage
  [key: string]: UsageTimePeriod | ExtraUsage | undefined
}

export interface CachedUsageData {
  data: UsageData
  timestamp: number  // Unix ms — when live data was last fetched from the API
}

export interface CodexCredentials {
  accessToken: string | null
}

export interface SaveCodexCredentialsPayload {
  accessToken: string
  cookieName?: string
}

export interface DetectCodexResult {
  success: boolean
  accessToken?: string
  cookieName?: string
  error?: string
}

export interface CodexUsageData {
  five_hour?: UsageTimePeriod
  seven_day?: UsageTimePeriod
}

export interface CachedCodexUsageData {
  data: CodexUsageData
  timestamp: number
}

export interface CopilotCredentials {
  accessToken: string | null
}

export interface CopilotDeviceFlowResult {
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface CopilotUsageItem {
  product: string
  sku: string
  model: string
  grossQuantity: number
}

export interface CopilotUsageData {
  copilot_plan: string            // 'free' | 'pro' | 'pro_plus' | 'business' | 'enterprise' | ''
  totalConsumed: number           // sum of all grossQuantity values this billing period
  entitlement: number             // monthly quota, 0 if unknown
  billingYear: number
  billingMonth: number            // 1–12
  usageItems: CopilotUsageItem[]  // per-model/product breakdown
}

export interface CachedCopilotUsageData {
  data: CopilotUsageData
  timestamp: number
}

export interface ElectronAPI {
  getCredentials: () => Promise<Credentials>
  saveCredentials: (credentials: SaveCredentialsPayload) => Promise<boolean>
  deleteCredentials: () => Promise<boolean>
  validateSessionKey: (sessionKey: string) => Promise<ValidationResult>
  detectSessionKey: () => Promise<DetectSessionResult>
  minimizeWindow: () => void
  closeWindow: () => void
  resizeWindow: (height: number) => void
  getWindowPosition: () => Promise<WindowBounds | null>
  setWindowPosition: (position: WindowPosition) => Promise<boolean>
  onRefreshUsage: (callback: () => void) => void
  onSessionExpired: (callback: () => void) => void
  onDebugLog: (callback: (label: string, data: unknown) => void) => void
  fetchUsageData: () => Promise<UsageData>
  getCachedUsage: () => Promise<CachedUsageData | null>
  openExternal: (url: string) => void
  updateTrayUsage: (stats: TrayUsageStats) => void
  getUsageHistory: () => Promise<UsageHistoryEntry[]>
  saveUsageHistoryEntry: (entry: UsageHistoryEntry) => Promise<boolean>
  clearUsageHistory: () => Promise<boolean>
  getPlatform: () => Promise<string>
  getRefreshIntervalMinutes: () => Promise<number>
  setRefreshIntervalMinutes: (minutes: number) => Promise<number>
  // Auto-start settings
  isAutoStartSupported: () => Promise<boolean>
  getAutoStart: () => Promise<boolean>
  setAutoStart: (enabled: boolean) => Promise<boolean>
  // Theme settings
  getTheme: () => Promise<string>
  setTheme: (theme: string) => Promise<string>
  getBackgroundHue: () => Promise<string>
  setBackgroundHue: (backgroundHue: string) => Promise<string>
  platform: string
  // Codex
  getCodexCredentials: () => Promise<CodexCredentials>
  saveCodexCredentials: (credentials: SaveCodexCredentialsPayload) => Promise<boolean>
  deleteCodexCredentials: () => Promise<boolean>
  detectCodexToken: () => Promise<DetectCodexResult>
  fetchCodexUsageData: () => Promise<CodexUsageData>
  getCachedCodexUsage: () => Promise<CachedCodexUsageData | null>
  onCodexSessionExpired: (callback: () => void) => void
  // Copilot
  getCopilotCredentials: () => Promise<CopilotCredentials>
  deleteCopilotCredentials: () => Promise<boolean>
  copilotGetClientId: () => Promise<string>
  copilotSetClientId: (clientId: string) => Promise<void>
  copilotStartDeviceFlow: () => Promise<CopilotDeviceFlowResult>
  fetchCopilotUsageData: () => Promise<CopilotUsageData>
  getCachedCopilotUsage: () => Promise<CachedCopilotUsageData | null>
  onCopilotSessionExpired: (callback: () => void) => void
  onCopilotAuthSuccess: (callback: () => void) => void
  onCopilotAuthFailed: (callback: (error: string) => void) => void
}
