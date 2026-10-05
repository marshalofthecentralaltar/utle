// The in-page engine (docs/ARCHITECTURE.md 21.2, 21.3): one recogniser and one InpageSession for
// the whole browser. No chrome.* here: the offscreen document wires it to the service worker, and
// the unit test wires it to fakes.

import type { BoxState, BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import type { InpageSession, InpageStep } from '../../src/core/inpage.ts'
import { STRINGS } from '../../src/core/strings.ts'
import type { Lang } from '../../src/core/strings.ts'
import type { Recognizer, RecognizerHandlers } from '../../src/speech/recognizer.ts'
import type { StripState } from './messages.ts'

/** The functions of src/core/inpage.ts the engine calls. The test build passes a stand-in. */
export interface InpageLogic {
  initialInpage(lang: Lang): InpageSession
  inpageStep(session: InpageSession, utterance: string, box: BoxState): InpageStep
  inpageResult(session: InpageSession, commands: readonly BrowserCommand[], result: BrowserResult): { session: InpageSession; line: string }
  inpageInstant(session: InpageSession, utterance: string): boolean
  inpagePreview(session: InpageSession, partial: string, box: BoxState): string | null
}

export interface EngineDeps {
  logic: InpageLogic
  lang: Lang
  /** Runs one command on the page in front. Never rejects with a reason the engine must know. */
  run(command: BrowserCommand): Promise<BrowserResult>
  publish(patch: Partial<StripState>): void
  /** Makes the recogniser. onUnavailable: the speech model cannot be reached. */
  recognizer(handlers: RecognizerHandlers, isInstant: (text: string) => boolean, onUnavailable: () => void): Recognizer
  /** The microphone was refused or is missing. */
  micBlocked(): void
}

export interface Engine {
  toggle(): void
  start(): void
  stop(): void
  readonly listening: boolean
  /** Resolves when every utterance so far, and every preview being typed, has been handled. For tests. */
  idle(): Promise<void>
}

const NO_BOX: BoxState = { present: false, text: '' }

/** One utterance being spoken: its base (the box before it began) and the preview in the box. */
interface Live {
  /** The box as it read when the utterance began. Null until readBox has answered. */
  base: BoxState | null
  /** Resolves once base is known. */
  ready: Promise<void>
  /** The newest partial. */
  partial: string
  /** The text this utterance last typed into the box, or null when it has typed nothing. */
  inBox: string | null
  /** The typing loop, while it runs. At most one setText is in flight. */
  typing: Promise<void> | null
  /** The utterance has ended (a final, or the microphone stopped): type no more previews. */
  over: boolean
}

export function createEngine(deps: EngineDeps): Engine {
  const text = STRINGS[deps.lang].strip
  let session = deps.logic.initialInpage(deps.lang)
  let listening = false
  let queue: Promise<void> = Promise.resolve()
  let live: Live | null = null

  const runSafe = async (command: BrowserCommand): Promise<BrowserResult> => {
    try {
      return await deps.run(command)
    } catch (error) {
      return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }

  const readBox = async (): Promise<BoxState> => {
    const read = await runSafe({ kind: 'readBox' })
    return read.ok && read.box ? read.box : NO_BOX
  }

  /** What this utterance wants in the box now, or null to leave the box alone. */
  const wanted = (u: Live): string | null => {
    const base = u.base
    if (base === null || !base.present) return null
    const preview = deps.logic.inpagePreview(session, u.partial, base)
    if (preview !== null) return preview
    // The words may be a command now: take back a preview already typed.
    return u.inBox !== null ? base.text : null
  }

  /** Types the newest wanted text, one setText at a time, skipping partials that came in between. */
  const type = (u: Live): void => {
    if (u.typing !== null) return
    u.typing = (async () => {
      await u.ready
      for (;;) {
        if (u.over) break
        const want = wanted(u)
        if (want === null || want === u.inBox) break
        u.inBox = want
        await runSafe({ kind: 'setText', text: want })
      }
      u.typing = null
    })()
  }

  /** Ends u's typing, waits for the setText in flight, and puts the base back if a preview is in the box. */
  const takeBack = async (u: Live): Promise<void> => {
    u.over = true
    await u.ready
    if (u.typing !== null) await u.typing
    const base = u.base
    if (base !== null && base.present && u.inBox !== null && u.inBox !== base.text) {
      u.inBox = base.text
      await runSafe({ kind: 'setText', text: base.text })
    }
  }

  const handle = async (utterance: string, u: Live | null): Promise<void> => {
    let box: BoxState
    if (u === null) {
      box = await readBox()
    } else {
      u.over = true
      await u.ready
      if (u.typing !== null) await u.typing
      // The base, never the box as it reads now: that holds the preview.
      box = u.base ?? NO_BOX
    }
    const step = deps.logic.inpageStep(session, utterance, box)
    session = step.session
    deps.publish({ line: step.line, resting: session.asleep })
    // A command, or nothing at all: the preview must not stay in the box.
    if (u !== null && !step.commands.some((c) => c.kind === 'setText')) await takeBack(u)
    if (step.commands.length === 0) return
    let last: BrowserResult = { ok: true }
    for (const command of step.commands) {
      last = await runSafe(command)
      if (!last.ok) break
    }
    const after = deps.logic.inpageResult(session, step.commands, last)
    session = after.session
    deps.publish({ line: after.line !== '' ? after.line : step.line, resting: session.asleep })
  }

  const begin = (): Live => {
    const u: Live = { base: null, ready: Promise.resolve(), partial: '', inBox: null, typing: null, over: false }
    // The base is read once, after every earlier utterance's commands have run.
    u.ready = queue.then(async () => {
      u.base = await readBox()
    })
    queue = u.ready
    return u
  }

  const recognizer = deps.recognizer(
    {
      onUtterance(utterance) {
        deps.publish({ heard: utterance })
        const u = live
        live = null
        if (u !== null) u.over = true
        queue = queue.then(() => handle(utterance, u))
      },
      onInterim(interim) {
        // An empty interim keeps the last words on the strip until new speech arrives.
        if (interim === '') return
        deps.publish({ heard: interim })
        if (!listening) return
        const u = live ?? begin()
        live = u
        u.partial = interim
        type(u)
      },
      onError() {
        listening = false
        deps.publish({ listening: false, problem: text.micBlocked })
        deps.micBlocked()
      },
      onNotice() {
        // The local recogniser has no fallback here; nothing to show.
      },
    },
    (utterance) => deps.logic.inpageInstant(session, utterance),
    () => {
      listening = false
      deps.publish({ listening: false, problem: text.modelUnreachable })
    },
  )

  const start = (): void => {
    if (listening) return
    listening = true
    deps.publish({ listening: true, problem: '', line: text.sayPrompt, resting: session.asleep })
    recognizer.start()
  }

  const stop = (): void => {
    if (!listening) return
    listening = false
    recognizer.stop()
    // Stopped in the middle of an utterance: no final will come, so its preview goes.
    const u = live
    live = null
    if (u !== null) {
      u.over = true
      queue = queue.then(() => takeBack(u))
    }
    deps.publish({ listening: false })
  }

  return {
    toggle() {
      if (listening) stop()
      else start()
    },
    start,
    stop,
    get listening() {
      return listening
    },
    async idle() {
      for (;;) {
        const q = queue
        await q
        const typing = live?.typing ?? null
        if (typing !== null) await typing
        if (q === queue && (live?.typing ?? null) === null) return
      }
    },
  }
}
