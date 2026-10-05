// The in-page engine (docs/ARCHITECTURE.md 21.2): one recogniser and one InpageSession for the
// whole browser. No chrome.* here: the offscreen document wires it to the service worker, and
// the unit test wires it to fakes.

import type { BoxState, BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import type { InpageSession, InpageStep } from '../../src/core/inpage.ts'
import { STRINGS } from '../../src/core/strings.ts'
import type { Lang } from '../../src/core/strings.ts'
import type { Recognizer, RecognizerHandlers } from '../../src/speech/recognizer.ts'
import type { StripState } from './messages.ts'

/** The four functions of src/core/inpage.ts. The test build passes a stand-in. */
export interface InpageLogic {
  initialInpage(lang: Lang): InpageSession
  inpageStep(session: InpageSession, utterance: string, box: BoxState): InpageStep
  inpageResult(session: InpageSession, commands: readonly BrowserCommand[], result: BrowserResult): { session: InpageSession; line: string }
  inpageInstant(session: InpageSession, utterance: string): boolean
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
  /** Resolves when every utterance so far has been handled. For tests. */
  idle(): Promise<void>
}

const NO_BOX: BoxState = { present: false, text: '' }

export function createEngine(deps: EngineDeps): Engine {
  const text = STRINGS[deps.lang].strip
  let session = deps.logic.initialInpage(deps.lang)
  let listening = false
  let queue: Promise<void> = Promise.resolve()

  const runSafe = async (command: BrowserCommand): Promise<BrowserResult> => {
    try {
      return await deps.run(command)
    } catch (error) {
      return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }

  const handle = async (utterance: string): Promise<void> => {
    const read = await runSafe({ kind: 'readBox' })
    const box = read.ok && read.box ? read.box : NO_BOX
    const step = deps.logic.inpageStep(session, utterance, box)
    session = step.session
    deps.publish({ line: step.line, resting: session.asleep })
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

  const recognizer = deps.recognizer(
    {
      onUtterance(utterance) {
        deps.publish({ heard: utterance })
        queue = queue.then(() => handle(utterance))
      },
      onInterim(interim) {
        // An empty interim keeps the last words on the strip until new speech arrives.
        if (interim !== '') deps.publish({ heard: interim })
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
    deps.publish({ listening: false, heard: '' })
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
    idle: () => queue,
  }
}
