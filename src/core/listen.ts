import { normalise } from './quickReply.ts'
import { wakeFind } from './wake.ts'
import type { WakeState } from './wake.ts'

/**
 * Round 10 (#2, LIMITED; ARCHITECTURE 32.1): the wake mode's three states, a pure machine with an
 * injected clock. The engine keeps the state, passes each final through listenFinal, tells it about
 * speech (listenHeard) and work (listenBusy), and publishes whether it is ACTIVE.
 *
 *   off      HARD_OFF: listening is off by his hand (the strip, the toolbar). Nothing is heard.
 *   passive  waiting for the word: nothing he or the room says reaches the bar, the box, the model
 *            or the queue; only the wake word does, anywhere in a final.
 *   active   after the word: every final is his, until ACTIVE_IDLE_MS of silence with no task
 *            running, a stop word, a sent message, or the bare word again.
 *
 * The order in the pipeline is binding: microphone, speaker gate, this, the engine. A wake never
 * authorises a speaker; this machine never sees words the gate rejected.
 */

/** ACTIVE ends after this long with no speech and no task running. */
export const ACTIVE_IDLE_MS = 20_000
/** A second bare word this soon after a wake is the same wake (an endpoint split, or said twice), not a toggle. */
export const WAKE_REPEAT_MS = 1500

/** What ends ACTIVE, with or without the word. */
const STOP = new Set(['aitab', 'see on kõik', 'see oli kõik', 'lõpeta kuulamine', 'thats all', 'that is all', 'stop listening'])

type ListenMode = 'off' | 'passive' | 'active'

export interface ListenState {
  mode: ListenMode
  /** Date.now() when ACTIVE ends with no further speech (ignored while busy). */
  until: number
  /** Date.now() of the last wake, for WAKE_REPEAT_MS. */
  wokeAt: number
  /** A task is running: ACTIVE does not end mid-command. */
  busy: boolean
  /** Finals heard in PASSIVE since the last wake: the strip's quiet counter. */
  ignored: number
}

/** off: nothing heard; ignored: PASSIVE, no word; woke: PASSIVE to ACTIVE; slept: ACTIVE to PASSIVE; stopped: a woken stop word in PASSIVE; passed: ACTIVE, the final goes on (or a repeated word). */
type ListenEvent = 'off' | 'ignored' | 'woke' | 'slept' | 'stopped' | 'passed'

export interface ListenStep {
  state: ListenState
  /** What the engine acts on, the word and the lead-in stripped; null for nothing. */
  utterance: string | null
  event: ListenEvent
}

export function createListen(): ListenState {
  return { mode: 'off', until: 0, wokeAt: Number.NEGATIVE_INFINITY, busy: false, ignored: 0 }
}

const isStopWord = (words: string): boolean => STOP.has(normalise(words))

/** Listening switched on by hand: PASSIVE. Already on: unchanged. */
export function listenOn(state: ListenState, _now: number): ListenState {
  return state.mode === 'off' ? { ...state, mode: 'passive', ignored: 0 } : state
}

/** Listening switched off by hand: HARD_OFF. */
export function listenOff(state: ListenState): ListenState {
  return { ...state, mode: 'off', busy: false }
}

export function listenActive(state: ListenState, now: number): boolean {
  return state.mode === 'active' && (state.busy || state.until > now)
}

/** ACTIVE that ran out goes back to PASSIVE. */
export function listenTick(state: ListenState, now: number): ListenState {
  return state.mode === 'active' && !listenActive(state, now) ? { ...state, mode: 'passive' } : state
}

/** Speech (a partial, or a final he made): ACTIVE runs ACTIVE_IDLE_MS from now. */
export function listenHeard(state: ListenState, now: number): ListenState {
  const s = listenTick(state, now)
  return s.mode === 'active' ? { ...s, until: now + ACTIVE_IDLE_MS } : s
}

/** A task started or ended. When the last one ends, the idle time starts from now. */
export function listenBusy(state: ListenState, busy: boolean, now: number): ListenState {
  if (state.busy === busy) return state
  if (busy) return { ...listenTick(state, now), busy }
  return state.mode === 'active' ? { ...state, busy, until: now + ACTIVE_IDLE_MS } : { ...state, busy }
}

/** ACTIVE ends (a message was sent): what the room says next is not typed. */
export function listenSleep(state: ListenState): ListenState {
  return state.mode === 'active' ? { ...state, mode: 'passive', ignored: 0 } : state
}

/** ACTIVE from now (dictation into a box he armed). */
export function listenWake(state: ListenState, now: number): ListenState {
  return state.mode === 'off' ? state : { ...state, mode: 'active', until: now + ACTIVE_IDLE_MS }
}

const woke = (state: ListenState, now: number): ListenState => ({ ...state, mode: 'active', until: now + ACTIVE_IDLE_MS, wokeAt: now, ignored: 0 })
const slept = (state: ListenState): ListenState => ({ ...state, mode: 'passive', ignored: 0 })

/** One final (after the speaker gate) through the machine. */
export function listenFinal(previous: ListenState, wake: WakeState, final: string, now: number): ListenStep {
  const state = listenTick(previous, now)
  if (state.mode === 'off') return { state, utterance: null, event: 'off' }
  if (state.mode === 'passive') {
    const hit = wakeFind(wake, final, true)
    if (hit === null) return { state: { ...state, ignored: state.ignored + 1 }, utterance: null, event: 'ignored' }
    if (isStopWord(hit.after)) return { state, utterance: null, event: 'stopped' }
    return { state: woke(state, now), utterance: hit.after === '' ? null : hit.after, event: 'woke' }
  }
  const hit = wakeFind(wake, final, false)
  const words = hit === null ? final : hit.after
  if (isStopWord(words)) return { state: slept(state), utterance: null, event: 'slept' }
  if (hit !== null && hit.after === '') {
    // The bare word again: a toggle, unless it is the same wake heard twice.
    if (now - state.wokeAt < WAKE_REPEAT_MS) return { state: { ...state, until: now + ACTIVE_IDLE_MS }, utterance: null, event: 'passed' }
    return { state: slept(state), utterance: null, event: 'slept' }
  }
  // A final without the word in between: a bare word after it is deliberate, never the same wake.
  const next: ListenState = { ...state, until: now + ACTIVE_IDLE_MS, wokeAt: hit === null ? Number.NEGATIVE_INFINITY : now }
  return { state: next, utterance: words, event: 'passed' }
}
