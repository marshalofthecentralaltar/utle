// Round 8 (29.4.1) and round 10 (32.1): the wake word. PASSIVE, ACTIVE or HARD_OFF, and the gate every
// final, continuation and partial passes first in wake mode.

import type { BoxState } from '../../../src/browser/protocol.ts'
import type { InpageStep } from '../../../src/core/inpage.ts'
import { createListen, listenActive, listenBusy, listenFinal, listenHeard, listenOff, listenOn, listenSleep, listenTick, listenWake } from '../../../src/core/listen.ts'
import type { ListenState } from '../../../src/core/listen.ts'
import { createWake, wakeFind, wakeStarts, wakeWordFrom } from '../../../src/core/wake.ts'
import type { WakeState } from '../../../src/core/wake.ts'
import type { EngineHandlers, EngineParts, Job } from './types.ts'

type WakeParts = Pick<EngineParts, 'deps' | 'wakeText' | 'jobCount' | 'entry' | 'enrolling' | 'whileReading' | 'dropLive' | 'isPlainSend'>

export function createWakeGate({ deps, wakeText, jobCount, entry, enrolling, whileReading, dropLive, isPlainSend }: WakeParts) {
  /** Round 8 (29.4.1): the wake word while listenMode is wake, else null. */
  const wake: WakeState | null = deps.wakeWord === undefined ? null : createWake(deps.wakeWord)
  /** Round 10 (32.1): PASSIVE, ACTIVE or HARD_OFF (src/core/listen.ts). */
  let listen: ListenState = createListen()
  /** What the strip was last told (wakeOpen = ACTIVE), so it is told on change only. */
  let wakeShown = false
  let wakeTimer: ReturnType<typeof setTimeout> | null = null
  /** The last final passed the gate: a continuation of it ("siis ...") passes too. */
  let lastPassed = false
  const windowOpen = (): boolean => wake !== null && listenActive(listen, Date.now())
  /** Publishes ACTIVE on change, says when it ended, and sets the timer for its end (none while a task runs). */
  const showWake = (quiet = false): void => {
    if (wake === null) return
    const now = Date.now()
    listen = listenTick(listen, now)
    const open = listenActive(listen, now)
    if (wakeTimer !== null) clearTimeout(wakeTimer)
    wakeTimer = null
    if (open && !listen.busy) {
      wakeTimer = setTimeout(() => {
        wakeTimer = null
        showWake()
      }, listen.until - now)
    }
    if (open === wakeShown) return
    wakeShown = open
    if (quiet) deps.publish({ wakeOpen: open })
    else deps.publish({ wakeOpen: open, line: open ? wakeText.active : wakeText.passive(wakeWordFrom(deps.wakeWord)) })
  }
  /** Round 10 (32.1): a task began or ended; ACTIVE does not end mid-command. */
  const listenWork = (): void => {
    if (wake === null) return
    listen = listenBusy(listen, jobCount() > 0, Date.now())
    showWake(true)
  }
  /** One final through the machine: the words to act on, or null when they go nowhere (not even the strip). */
  const wakeFilter = (word: WakeState, utterance: string): string | null => {
    const r = listenFinal(listen, word, utterance, Date.now())
    listen = r.state
    lastPassed = r.utterance !== null
    if (r.event === 'ignored') deps.publish({ ignored: wakeText.notForMe(listen.ignored) })
    if (r.event === 'woke') deps.publish({ ignored: '' })
    // A woken command says its own line; the bare word says "Kuulan sind.".
    showWake(r.event === 'passed' || r.utterance !== null)
    return r.utterance
  }
  /** Dictation by the rules into an armed box keeps ACTIVE (a send never does). */
  const wakeDictation = (job: Job, box: BoxState, rules: InpageStep): void => {
    if (wake === null || job.send || !box.present || !box.armed) return
    if (!rules.commands.some((c) => c.kind === 'setText')) return
    listen = listenWake(listen, Date.now())
    showWake(true)
  }
  /** Listening stopped by hand: HARD_OFF, without a line. */
  const wakeStopped = (): void => {
    if (wake === null) return
    listen = listenOff(listen)
    lastPassed = false
    showWake(true)
  }
  /** Listening started by hand: PASSIVE. */
  const wakeStarted = (): void => {
    if (wake === null) return
    listen = listenOn(listen, Date.now())
    showWake(true)
  }
  /** Installs the gate on the handlers, in place. */
  const gate = (handlers: EngineHandlers): void => {
    // Round 8 (29.4.1): in wake mode every final, continuation and partial passes the gate first. The
    // voice entry flow (26.5) and enrolment are not gated.
    if (wake === null) return
    const word = wake
    const ungated = { onUtterance: handlers.onUtterance, onUtteranceContinued: handlers.onUtteranceContinued, onInterim: handlers.onInterim }
    const gated = (): boolean => !entry() && !enrolling()
    handlers.onUtterance = (utterance) => {
      // 29.5: while reading, the reading's filter comes before the gate: a stop word stops it without the wake word.
      if (!enrolling() && whileReading(utterance)) return
      if (!gated()) return ungated.onUtterance(utterance)
      const passed = wakeFilter(word, utterance)
      if (passed === null) {
        // Round 10 (32.1): PASSIVE, a toggle or a stop word: nothing of it reaches the strip, the box or the queue.
        dropLive()
        return
      }
      const closes = windowOpen() && isPlainSend(passed)
      ungated.onUtterance(passed)
      // The message is gone: what the room says next must not be typed.
      if (closes) {
        listen = listenSleep(listen)
        showWake(true)
      }
    }
    handlers.onUtteranceContinued = (text, added) => {
      if (!enrolling() && whileReading(added)) return
      if (!gated()) return ungated.onUtteranceContinued(text, added)
      if (lastPassed && windowOpen()) {
        const rest = wakeStarts(word, added)
        listen = listenHeard(listen, Date.now())
        showWake(true)
        return ungated.onUtteranceContinued(text, rest === null || rest === '' ? added : rest)
      }
      // What it continues was dropped: these words are a final of their own.
      handlers.onUtterance(added)
    }
    handlers.onInterim = (interim) => {
      if (deps.reading?.() === true) return
      if (!gated() || interim === '') return ungated.onInterim(interim)
      if (windowOpen()) {
        listen = listenHeard(listen, Date.now())
        showWake(true)
        return ungated.onInterim(interim)
      }
      // Round 10 (32.1): PASSIVE. Nothing is shown or typed, except the words after a wake word heard just now.
      const hit = wakeFind(word, interim, true)
      if (hit !== null && hit.after !== '') deps.publish({ heard: hit.after })
    }
  }
  return { on: wake !== null, windowOpen, listenWork, wakeDictation, wakeStopped, wakeStarted, gate }
}
