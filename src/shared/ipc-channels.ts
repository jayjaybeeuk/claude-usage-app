export const IpcChannels = {
  // invoke (renderer -> main, returns promise)
  GET_CREDENTIALS: 'get-credentials',
  SAVE_CREDENTIALS: 'save-credentials',
  DELETE_CREDENTIALS: 'delete-credentials',
  VALIDATE_SESSION_KEY: 'validate-session-key',
  DETECT_SESSION_KEY: 'detect-session-key',
  FETCH_USAGE_DATA: 'fetch-usage-data',
  GET_PLATFORM: 'get-platform',
  GET_WINDOW_POSITION: 'get-window-position',
  SET_WINDOW_POSITION: 'set-window-position',
  GET_USAGE_HISTORY: 'get-usage-history',
  SAVE_USAGE_HISTORY_ENTRY: 'save-usage-history-entry',
  CLEAR_USAGE_HISTORY: 'clear-usage-history',
  GET_REFRESH_INTERVAL: 'get-refresh-interval',
  SET_REFRESH_INTERVAL: 'set-refresh-interval',
  GET_CACHED_USAGE: 'get-cached-usage',

  // send (renderer -> main, fire-and-forget)
  MINIMIZE_WINDOW: 'minimize-window',
  CLOSE_WINDOW: 'close-window',
  RESIZE_WINDOW: 'resize-window',
  OPEN_EXTERNAL: 'open-external',
  UPDATE_TRAY_USAGE: 'update-tray-usage',

  // Codex invoke channels
  GET_CODEX_CREDENTIALS: 'get-codex-credentials',
  SAVE_CODEX_CREDENTIALS: 'save-codex-credentials',
  DELETE_CODEX_CREDENTIALS: 'delete-codex-credentials',
  DETECT_CODEX_TOKEN: 'detect-codex-token',
  FETCH_CODEX_USAGE: 'fetch-codex-usage',
  GET_CACHED_CODEX_USAGE: 'get-cached-codex-usage',

  // Auto-start settings
  GET_AUTO_START: 'get-auto-start',
  SET_AUTO_START: 'set-auto-start',
  IS_AUTO_START_SUPPORTED: 'is-auto-start-supported',

  // Theme settings
  GET_THEME: 'get-theme',
  SET_THEME: 'set-theme',
  GET_BACKGROUND_HUE: 'get-background-hue',
  SET_BACKGROUND_HUE: 'set-background-hue',

  // Copilot invoke channels
  GET_COPILOT_CREDENTIALS: 'get-copilot-credentials',
  DELETE_COPILOT_CREDENTIALS: 'delete-copilot-credentials',
  COPILOT_GET_CLIENT_ID: 'copilot-get-client-id',
  COPILOT_SET_CLIENT_ID: 'copilot-set-client-id',
  COPILOT_START_DEVICE_FLOW: 'copilot-start-device-flow',
  FETCH_COPILOT_USAGE: 'fetch-copilot-usage',
  GET_CACHED_COPILOT_USAGE: 'get-cached-copilot-usage',

  // on (main -> renderer)
  REFRESH_USAGE: 'refresh-usage',
  SESSION_EXPIRED: 'session-expired',
  CODEX_SESSION_EXPIRED: 'codex-session-expired',
  COPILOT_SESSION_EXPIRED: 'copilot-session-expired',
  COPILOT_AUTH_SUCCESS: 'copilot-auth-success',
  COPILOT_AUTH_FAILED: 'copilot-auth-failed',
  DEBUG_LOG: 'debug-log',
} as const
