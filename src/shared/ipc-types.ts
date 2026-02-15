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
}

export interface UsageHistoryEntry {
  timestamp: number
  session: number
  weekly: number
  sonnet: number
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
  fetchUsageData: () => Promise<UsageData>
  openExternal: (url: string) => void
  updateTrayUsage: (stats: TrayUsageStats) => void
  getUsageHistory: () => Promise<UsageHistoryEntry[]>
  saveUsageHistoryEntry: (entry: UsageHistoryEntry) => Promise<boolean>
  clearUsageHistory: () => Promise<boolean>
  getPlatform: () => Promise<string>
  platform: string
}
