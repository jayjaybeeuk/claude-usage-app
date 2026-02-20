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

  // on (main -> renderer)
  REFRESH_USAGE: 'refresh-usage',
  SESSION_EXPIRED: 'session-expired',
  DEBUG_LOG: 'debug-log',
} as const
