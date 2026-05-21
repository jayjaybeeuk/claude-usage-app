export const DEBUG = new URLSearchParams(window.location.search).has('debug')

export function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log('[Debug]', ...args)
}

// Update progress bar
export function updateProgressBar(
  progressElement: HTMLDivElement,
  percentageElement: HTMLSpanElement,
  value: number,
): void {
  const percentage = Math.min(Math.max(value, 0), 100)

  progressElement.style.width = `${percentage}%`
  percentageElement.textContent = `${Math.round(percentage)}%`

  // Update color based on usage level
  progressElement.classList.remove('warning', 'danger')
  if (percentage >= 90) {
    progressElement.classList.add('danger')
  } else if (percentage >= 75) {
    progressElement.classList.add('warning')
  }
}

// Update circular timer
export function updateTimer(
  timerElement: SVGCircleElement,
  textElement: HTMLElement,
  resetsAt: string | null | undefined,
  totalMinutes: number,
): void {
  if (!resetsAt) {
    textElement.textContent = '--:--'
    textElement.style.opacity = '0.5'
    textElement.title = 'Starts when a message is sent'
    timerElement.style.strokeDashoffset = '63'
    return
  }

  // Clear the greyed out styling and tooltip when timer is active
  textElement.style.opacity = '1'
  textElement.title = ''

  const resetDate = new Date(resetsAt)
  const now = new Date()
  const diff = resetDate.getTime() - now.getTime()

  if (diff <= 0) {
    textElement.textContent = 'Resetting...'
    timerElement.style.strokeDashoffset = '0'
    return
  }

  // Calculate remaining time
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  // Format time display
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    textElement.textContent = `${days}d ${remainingHours}h`
  } else if (hours > 0) {
    textElement.textContent = `${hours}h ${minutes}m`
  } else {
    textElement.textContent = `${minutes}m`
  }

  // Calculate progress (elapsed percentage)
  const totalMs = totalMinutes * 60 * 1000
  const elapsedMs = totalMs - diff
  const elapsedPercentage = (elapsedMs / totalMs) * 100

  // Update circle (63 is ~2*pi*10)
  const circumference = 63
  const offset = circumference - (elapsedPercentage / 100) * circumference
  timerElement.style.strokeDashoffset = String(offset)

  // Update color based on remaining time
  timerElement.classList.remove('warning', 'danger')
  if (elapsedPercentage >= 90) {
    timerElement.classList.add('danger')
  } else if (elapsedPercentage >= 75) {
    timerElement.classList.add('warning')
  }
}

// Update inner usage ring (shows percentage utilization)
export function updateUsageRing(ringElement: SVGCircleElement, utilization: number): void {
  const percentage = Math.min(Math.max(utilization, 0), 100)
  const circumference = 2 * Math.PI * 6 // r=6, so ~37.7
  const offset = circumference - (percentage / 100) * circumference
  ringElement.style.strokeDashoffset = String(offset)
}