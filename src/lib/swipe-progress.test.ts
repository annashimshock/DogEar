import { describe, expect, it } from 'vitest'
import { swipeProgress } from './swipe-progress'

describe('swipe tracker progress', () => {
  it('starts with the whole initial stack remaining', () => {
    expect(swipeProgress(17, 0)).toEqual({
      total: 17,
      completed: 0,
      remaining: 17,
      percent: 0,
    })
  })

  it('counts the visible card as remaining after one swipe', () => {
    const progress = swipeProgress(17, 1)
    expect(progress.completed).toBe(1)
    expect(progress.remaining).toBe(16)
    expect(progress.remaining).toBe(progress.total - progress.completed)
  })

  it('stays consistent after advancing multiple books', () => {
    const progress = swipeProgress(17, 5)
    expect(progress.completed).toBe(5)
    expect(progress.remaining).toBe(12)
    expect(progress.percent).toBeCloseTo((5 / 17) * 100)
  })

  it('shows one book left on the final visible card', () => {
    const progress = swipeProgress(17, 16)
    expect(progress.completed).toBe(16)
    expect(progress.remaining).toBe(1)
    expect(progress.percent).toBeLessThan(100)
  })

  it('finishes the stack after the last card is swiped', () => {
    expect(swipeProgress(17, 17)).toEqual({
      total: 17,
      completed: 17,
      remaining: 0,
      percent: 100,
    })
  })

  it('updates forward when another batch is appended', () => {
    const before = swipeProgress(17, 17)
    const after = swipeProgress(21, before.completed)
    expect(after.completed).toBe(17)
    expect(after.remaining).toBe(4)
    expect(after.percent).toBeCloseTo((17 / 21) * 100)
  })

  it('clamps completed when filtering or deduplication shrinks the queue', () => {
    const progress = swipeProgress(10, 13)
    expect(progress.completed).toBe(10)
    expect(progress.remaining).toBe(0)
    expect(progress.percent).toBe(100)
  })

  it('handles an empty queue', () => {
    expect(swipeProgress(0, 0)).toEqual({
      total: 0,
      completed: 0,
      remaining: 0,
      percent: 0,
    })
    expect(swipeProgress(0, 4).completed).toBe(0)
  })
})
