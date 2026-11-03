import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGaze, GAZE_OFF_MS, GAZE_ON_MS, GAZE_POLL_MS } from './gaze.ts'
import type { GazePhase } from './gaze.ts'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const started = vi.fn()
  const stopped = vi.fn()
  const phases: GazePhase[] = []
  const gaze = createGaze({ onStart: started, onStop: stopped, onPhase: (p) => phases.push(p) })
  return { started, stopped, phases, gaze }
}

describe('gaze', () => {
  it('has the agreed timings', () => {
    expect(GAZE_ON_MS).toBe(250)
    expect(GAZE_OFF_MS).toBe(600)
    expect(GAZE_POLL_MS).toBe(1000)
  })

  it('starts after the pointer has rested GAZE_ON_MS, not on a pass-through', () => {
    const { started, stopped, phases, gaze } = setup()
    gaze.enter()
    expect(phases).toEqual(['arming'])
    vi.advanceTimersByTime(GAZE_ON_MS - 1)
    expect(started).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(started).toHaveBeenCalledTimes(1)
    expect(gaze.phase).toBe('on')
    expect(stopped).not.toHaveBeenCalled()
  })

  it('a pass-through never starts and never stops', () => {
    const { started, stopped, phases, gaze } = setup()
    gaze.enter()
    vi.advanceTimersByTime(100)
    gaze.leave()
    vi.advanceTimersByTime(GAZE_OFF_MS * 2)
    expect(started).not.toHaveBeenCalled()
    expect(stopped).not.toHaveBeenCalled()
    expect(phases).toEqual(['arming', 'off'])
  })

  it('stops GAZE_OFF_MS after the pointer left', () => {
    const { started, stopped, phases, gaze } = setup()
    gaze.enter()
    vi.advanceTimersByTime(GAZE_ON_MS)
    gaze.leave()
    expect(gaze.phase).toBe('leaving')
    vi.advanceTimersByTime(GAZE_OFF_MS - 1)
    expect(stopped).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(started).toHaveBeenCalledTimes(1)
    expect(phases).toEqual(['arming', 'on', 'leaving', 'off'])
  })

  it('a jitter out and back within the grace keeps listening without a restart', () => {
    const { started, stopped, gaze } = setup()
    gaze.enter()
    vi.advanceTimersByTime(GAZE_ON_MS)
    gaze.leave()
    vi.advanceTimersByTime(GAZE_OFF_MS - 50)
    gaze.enter()
    expect(gaze.phase).toBe('on')
    vi.advanceTimersByTime(GAZE_OFF_MS * 3)
    expect(stopped).not.toHaveBeenCalled()
    expect(started).toHaveBeenCalledTimes(1)
  })

  it('repeated enters and leaves are idempotent', () => {
    const { started, stopped, gaze } = setup()
    gaze.enter()
    gaze.enter()
    vi.advanceTimersByTime(GAZE_ON_MS)
    expect(started).toHaveBeenCalledTimes(1)
    gaze.leave()
    gaze.leave()
    vi.advanceTimersByTime(GAZE_OFF_MS)
    expect(stopped).toHaveBeenCalledTimes(1)
    gaze.leave()
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('dispose stops at once when it was on, and is silent otherwise', () => {
    const a = setup()
    a.gaze.enter()
    vi.advanceTimersByTime(GAZE_ON_MS)
    a.gaze.dispose()
    expect(a.stopped).toHaveBeenCalledTimes(1)
    expect(a.gaze.phase).toBe('off')

    const b = setup()
    b.gaze.enter()
    b.gaze.dispose()
    vi.advanceTimersByTime(GAZE_ON_MS * 2)
    expect(b.started).not.toHaveBeenCalled()
    expect(b.stopped).not.toHaveBeenCalled()
  })
})
