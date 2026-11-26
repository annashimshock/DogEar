/**
 * One source of truth for the swipe tracker.
 *
 * `completed` is the number of cards the reader has already swiped. The card
 * currently on screen is therefore still remaining, so the invariant is always
 * `remaining = total - completed`.
 */
export interface SwipeProgress {
  total: number
  completed: number
  remaining: number
  /** 0–100, based only on completed swipes. */
  percent: number
}

function wholeCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export function swipeProgress(total: number, completed: number): SwipeProgress {
  const safeTotal = wholeCount(total)
  const safeCompleted = Math.min(safeTotal, wholeCount(completed))
  const remaining = safeTotal - safeCompleted

  return {
    total: safeTotal,
    completed: safeCompleted,
    remaining,
    percent: safeTotal === 0 ? 0 : (safeCompleted / safeTotal) * 100,
  }
}
