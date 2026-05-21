export interface AIProvider {
  /** Uniquely identifies the provider (e.g., 'claude', 'codex', 'copilot', 'gemini') */
  id: string

  /** Indicates if valid data has been successfully fetched */
  hasData: boolean

  /** The last time this provider successfully refreshed its data */
  lastRefreshTime: number | null

  /** Bootstraps the provider, checking existing credentials and rendering initial state */
  init(): Promise<void>

  /** Fetches new data from the main process and updates the local state */
  fetchData(): Promise<void>

  /** Updates the DOM specific to this provider */
  updateUI(): void

  /** Updates or renders the charts (if applicable) */
  renderCharts(): void

  /** Starts the countdown timers and UI loops */
  startTimers(): void

  /** Stops the countdown timers and UI loops */
  stopTimers(): void

  /** Switches the UI to show the login prompt for this provider */
  showLogin(): void

  /** Cleans up listeners, intervals, and memory when logging out or quitting */
  destroy(): void
}

export abstract class BaseProvider implements AIProvider {
  abstract id: string
  hasData = false
  lastRefreshTime: number | null = null

  protected intervals: ReturnType<typeof setInterval>[] = []

  abstract init(): Promise<void>
  abstract fetchData(): Promise<void>
  abstract updateUI(): void
  abstract renderCharts(): void
  abstract startTimers(): void
  abstract showLogin(): void

  stopTimers(): void {
    this.intervals.forEach((interval) => clearInterval(interval))
    this.intervals = []
  }

  protected registerInterval(interval: ReturnType<typeof setInterval>): void {
    this.intervals.push(interval)
  }

  destroy(): void {
    this.stopTimers()
    this.hasData = false
    this.lastRefreshTime = null
  }
}