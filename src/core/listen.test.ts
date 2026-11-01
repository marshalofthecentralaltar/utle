import { describe, expect, it } from 'vitest'
import { ACTIVE_IDLE_MS, WAKE_REPEAT_MS, createListen, listenActive, listenBusy, listenFinal, listenHeard, listenOff, listenOn, listenSleep, listenTick } from './listen.ts'
import type { ListenState } from './listen.ts'
import { createWake } from './wake.ts'

const W = createWake('Ütle')
const T0 = 1_000_000

/** Feeds finals one second apart from `at`; returns the state and what the engine got (null: nothing). */
function feed(start: ListenState, finals: readonly string[], at = T0, step = 1000): { state: ListenState; got: Array<string | null>; now: number } {
  let state = start
  let now = at
  const got: Array<string | null> = []
  for (const final of finals) {
    now += step
    const r = listenFinal(state, W, final, now)
    state = r.state
    got.push(r.utterance)
  }
  return { state, got, now }
}

const passive = (): ListenState => listenOn(createListen(), T0)

describe('round 10 (#2, limited): PASSIVE / ACTIVE / HARD_OFF', () => {
  it('starts off; a manual on is PASSIVE; off is HARD_OFF and hears nothing, not even the word', () => {
    expect(createListen().mode).toBe('off')
    expect(passive().mode).toBe('passive')
    const off = listenOff(listenFinal(passive(), W, 'Ütle', T0 + 1).state)
    expect(off.mode).toBe('off')
    const r = listenFinal(off, W, 'Ütle, ava youtube', T0 + 2)
    expect(r.utterance).toBeNull()
    expect(r.state.mode).toBe('off')
    expect(r.event).toBe('off')
  })

  it('PASSIVE: room talk goes nowhere and is counted; the count starts again at the next wake', () => {
    const { state, got } = feed(passive(), ['tere Mari', 'kas sa kuuled', 'Ma ütlen sulle homme.'])
    expect(got).toEqual([null, null, null])
    expect(state.mode).toBe('passive')
    expect(state.ignored).toBe(3)
    const r = listenFinal(state, W, 'Ütle.', T0 + 10_000)
    expect(r.event).toBe('woke')
    expect(r.state.ignored).toBe(0)
  })

  it('standalone "Ütle" toggles: PASSIVE to ACTIVE, then ACTIVE to PASSIVE, no text either way', () => {
    let r = listenFinal(passive(), W, 'Ütle.', T0 + 1000)
    expect([r.state.mode, r.utterance, r.event]).toEqual(['active', null, 'woke'])
    r = listenFinal(r.state, W, 'Ütle', T0 + 5000)
    expect([r.state.mode, r.utterance, r.event]).toEqual(['passive', null, 'slept'])
  })

  it('"Ütle, <command>" runs once and stays ACTIVE; a follow-up needs no word', () => {
    const { state, got } = feed(passive(), ['No nii, Ütle, ava YouTube.', 'keri alla', 'Ütle, keri alla'])
    expect(got).toEqual(['ava YouTube.', 'keri alla', 'keri alla'])
    expect(state.mode).toBe('active')
  })

  it('"Ütle, lõpeta kuulamine" and "aitab" go to PASSIVE and type nothing', () => {
    for (const stop of ['Ütle, lõpeta kuulamine', 'aitab', 'Ütle, aitab', 'see on kõik']) {
      const woke = listenFinal(passive(), W, 'Ütle', T0 + 1000).state
      const r = listenFinal(woke, W, stop, T0 + 3000)
      expect([r.state.mode, r.utterance], stop).toEqual(['passive', null])
    }
    // PASSIVE: a woken stop word does nothing at all.
    const r = listenFinal(passive(), W, 'ütle aitab', T0 + 1000)
    expect([r.state.mode, r.utterance]).toEqual(['passive', null])
  })

  it('ACTIVE: "kirjuta siia sõna ütle" and a word inside a sentence are his text, no toggle', () => {
    const woke = listenFinal(passive(), W, 'Ütle', T0).state
    const { state, got } = feed(woke, ['Kirjuta siia sõna ütle.', 'kirjuta Marile et ütle emale tere'])
    expect(got).toEqual(['Kirjuta siia sõna ütle.', 'kirjuta Marile et ütle emale tere'])
    expect(state.mode).toBe('active')
  })

  it('idle expiry: ACTIVE goes back to PASSIVE ACTIVE_IDLE_MS after the last speech; a partial is speech', () => {
    let s = listenFinal(passive(), W, 'Ütle', T0).state
    expect(listenActive(s, T0 + ACTIVE_IDLE_MS - 1)).toBe(true)
    s = listenHeard(s, T0 + 15_000)
    expect(listenActive(s, T0 + 15_000 + ACTIVE_IDLE_MS - 1)).toBe(true)
    expect(listenActive(s, T0 + 15_000 + ACTIVE_IDLE_MS)).toBe(false)
    expect(listenTick(s, T0 + 15_000 + ACTIVE_IDLE_MS).mode).toBe('passive')
    const r = listenFinal(s, W, 'keri alla', T0 + 15_000 + ACTIVE_IDLE_MS + 1)
    expect(r.utterance).toBeNull()
    expect(r.event).toBe('ignored')
  })

  it('does not sleep mid-command: while busy the idle time does not run; it starts again when the task ends', () => {
    let s = listenFinal(passive(), W, "Ütle, mine youtube'i ja ava video", T0).state
    s = listenBusy(s, true, T0 + 100)
    expect(listenActive(s, T0 + 60_000)).toBe(true)
    expect(listenTick(s, T0 + 60_000).mode).toBe('active')
    s = listenBusy(s, false, T0 + 60_000)
    expect(listenActive(s, T0 + 60_000 + ACTIVE_IDLE_MS - 1)).toBe(true)
    expect(listenActive(s, T0 + 60_000 + ACTIVE_IDLE_MS)).toBe(false)
  })

  it('no duplicate: two wakes close together are one (an endpoint split, or said twice), never ACTIVE and back', () => {
    let r = listenFinal(passive(), W, 'Ütle', T0)
    r = listenFinal(r.state, W, 'Ütle', T0 + WAKE_REPEAT_MS - 1)
    expect([r.state.mode, r.utterance]).toEqual(['active', null])
    // Later, the bare word is a deliberate toggle.
    r = listenFinal(r.state, W, 'Ütle', T0 + WAKE_REPEAT_MS + 5000)
    expect(r.state.mode).toBe('passive')
  })

  it('an endpoint split: "Ütle" then "ava Gmail" as two finals wakes and runs the second, without a second word', () => {
    const { state, got } = feed(passive(), ['Ütle', 'ava Gmail'], T0, 600)
    expect(got).toEqual([null, 'ava Gmail'])
    expect(state.mode).toBe('active')
  })

  it('a sent message (listenSleep) goes back to PASSIVE', () => {
    const s = listenFinal(passive(), W, 'Ütle, tere', T0).state
    expect(listenSleep(s).mode).toBe('passive')
  })
})
