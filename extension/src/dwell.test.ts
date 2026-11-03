import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDwell, DWELL_MS } from './dwell.ts'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const fired = vi.fn()
  const changes: boolean[] = []
  const dwell = createDwell({ onFire: fired, onChange: (dwelling) => changes.push(dwelling) })
  return { fired, changes, dwell }
}

describe('dwell', () => {
  it('is about one second', () => {
    expect(DWELL_MS).toBe(1000)
  })

  it('fires once at the threshold, not before', () => {
    const { fired, changes, dwell } = setup()
    dwell.enter()
    expect(changes).toEqual([true])
    vi.advanceTimersByTime(DWELL_MS - 1)
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fired).toHaveBeenCalledTimes(1)
    expect(changes).toEqual([true, false])
    vi.advanceTimersByTime(DWELL_MS * 5)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it('leaving cancels', () => {
    const { fired, changes, dwell } = setup()
    dwell.enter()
    vi.advanceTimersByTime(DWELL_MS - 100)
    dwell.leave()
    vi.advanceTimersByTime(DWELL_MS * 2)
    expect(fired).not.toHaveBeenCalled()
    expect(changes).toEqual([true, false])
  })

  it('does not refire until the pointer has left and come back', () => {
    const { fired, dwell } = setup()
    dwell.enter()
    vi.advanceTimersByTime(DWELL_MS)
    dwell.enter() // pointer jitter inside the control
    vi.advanceTimersByTime(DWELL_MS * 3)
    expect(fired).toHaveBeenCalledTimes(1)
    dwell.leave()
    dwell.enter()
    vi.advanceTimersByTime(DWELL_MS)
    expect(fired).toHaveBeenCalledTimes(2)
  })

  it('a click after the dwell fired in the same hover is ignored, so dwell-click does not toggle twice', () => {
    const { fired, dwell } = setup()
    dwell.enter()
    vi.advanceTimersByTime(DWELL_MS)
    expect(dwell.click()).toBe(false)
    expect(fired).toHaveBeenCalledTimes(1)
    dwell.leave()
    expect(dwell.click()).toBe(true) // a later click, e.g. from the keyboard, acts
  })

  it('a click before the dwell acts and cancels the dwell', () => {
    const { fired, changes, dwell } = setup()
    dwell.enter()
    vi.advanceTimersByTime(DWELL_MS / 2)
    expect(dwell.click()).toBe(true)
    expect(changes).toEqual([true, false])
    vi.advanceTimersByTime(DWELL_MS * 2)
    expect(fired).not.toHaveBeenCalled()
  })

  it('dispose stops a running dwell', () => {
    const { fired, dwell } = setup()
    dwell.enter()
    dwell.dispose()
    vi.advanceTimersByTime(DWELL_MS * 2)
    expect(fired).not.toHaveBeenCalled()
  })
})
