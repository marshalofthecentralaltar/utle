// The in-page engine (docs/ARCHITECTURE.md 21.2, 21.3): one recogniser and one InpageSession for
// the whole browser. No chrome.* here: the offscreen document wires it to the service worker, and
// the unit test wires it to fakes.

import type { BoxState, BrowserCommand, BrowserResult, PageContext } from '../../src/browser/protocol.ts'
import type { InpageSession, InpageStep } from '../../src/core/inpage.ts'
import type { IntentAnswer, IntentRequest, IntentStep, PageIntent, TabSummary } from '../../src/core/pageIntent.ts'
import { MAX_INTENT_STEPS } from '../../src/core/pageIntent.ts'
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
  /** M7: the step for what the model said the utterance meant. */
  applyIntent(session: InpageSession, intent: PageIntent, page: PageContext, say?: string): InpageStep
  /** M7: the model's answer checked against the page, or null. */
  pageIntentFrom(input: unknown, request: Pick<IntentRequest, 'page' | 'tabs'>): PageIntent | null
}

/** Why the model gave no answer: no key on the server, the server cannot be reached, or an answer of the wrong shape. */
export type AskFailure = { error: 'no_model' | 'unreachable' | 'bad' }

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
  /** M7: asks the model (POST /api/intent) what an utterance meant on this page. Never rejects. */
  ask(request: IntentRequest): Promise<IntentAnswer | AskFailure>
  /** M7: the tabs of the window being driven, left to right. */
  tabs(): Promise<TabSummary[]>
  /** M7: whether the server has a model, checked once when the engine starts. */
  status(): Promise<'live' | 'no_key' | 'unreachable'>
}

export interface Engine {
  toggle(): void
  start(): void
  stop(): void
  readonly listening: boolean
  /** Push-to-talk released: the words spoken so far are delivered now, listening stays as it is. */
  flush(): void
  /** Resolves when every utterance so far, and every preview being typed, has been handled. For tests. */
  idle(): Promise<void>
}

const NO_BOX: BoxState = { present: false, text: '', armed: false }

/** The model is not asked about an utterance this long when the box is armed: a sentence is dictation. */
export const LONG_UTTERANCE_WORDS = 14
/** The model must answer within this time, or the rules' step stands. */
/** Longer than the server's own 7 s, so a slow model answers 504 and the engine sees it rather than giving up first. */
export const ASK_TIMEOUT_MS = 9000
/** How many strip lines the model is told about, and how long each may be (IntentRequestSchema: 200). */
const RECENT_LINES = 3
/** M7.2: a multi-step utterance gets no further step once this long has passed since it arrived. */
export const INTENT_LOOP_BUDGET_MS = 25_000
/** M7.2: the loop stops after this many failed steps (one failure is reported back so the model may recover). */
export const MAX_STEP_FAILURES = 2
/** M7.2: how long the page gets to render after a step before it is read again (a goTo already waited for the load). */
export const SETTLE_MS = 300
const RECENT_LINE_CHARS = 200
/** The request's limits in IntentRequestSchema: a page beyond them would be a 400, and the model never asked. */
const URL_CHARS = 2000
const TITLE_CHARS = 300
const BOX_CHARS = 4000

const wordCount = (utterance: string): number => utterance.trim().split(/\s+/).filter((w) => w !== '').length

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
  const inpageText = STRINGS[deps.lang].inpage
  let session = deps.logic.initialInpage(deps.lang)
  let listening = false
  let queue: Promise<void> = Promise.resolve()
  let live: Live | null = null
  /** The last lines the strip showed about utterances, newest last. */
  let recent: string[] = []
  /** The server has said it has no model. A standing state: published on change only. */
  let modelOff = false

  const setModelOff = (off: boolean): void => {
    if (off === modelOff) return
    modelOff = off
    deps.publish({ modelProblem: off ? inpageText.modelOff : '' })
  }

  /** Publishes a line about an utterance and remembers it for the model. */
  const say = (line: string): void => {
    if (line !== '') recent = [...recent, line.slice(0, RECENT_LINE_CHARS)].slice(-RECENT_LINES)
    deps.publish({ line, resting: session.asleep })
  }

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

  /**
   * The page in front for the model: readPage, or what is known from the box when the page cannot
   * answer. baseText, when given, replaces the box text: the box as it was before the utterance,
   * never with the utterance's own words in it, so the model judges the words themselves.
   */
  const readPage = async (box: BoxState, baseText: string | null): Promise<PageContext> => {
    const read = await runSafe({ kind: 'readPage' })
    const fallback: PageContext = { url: '', title: '', box: baseText === null ? box : { ...box, text: baseText }, items: [], media: null, hints: session.hints }
    const page = !read.ok || !read.page ? fallback : baseText === null ? read.page : { ...read.page, box: { ...read.page.box, text: baseText } }
    // Clipped to IntentRequestSchema's limits: a page beyond them would be a 400, and the model never asked.
    return { ...page, url: page.url.slice(0, URL_CHARS), title: page.title.slice(0, TITLE_CHARS), box: { ...page.box, text: page.box.text.slice(0, BOX_CHARS) } }
  }

  const askWithTimeout = (request: IntentRequest): Promise<IntentAnswer | AskFailure> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: 'unreachable' }), ASK_TIMEOUT_MS)
      deps.ask(request).then(
        (answer) => {
          clearTimeout(timer)
          resolve(answer)
        },
        () => {
          clearTimeout(timer)
          resolve({ error: 'unreachable' })
        },
      )
    })

  /** The model's answer, validated against the page it saw. */
  interface Heard {
    intent: PageIntent
    say: string
    /** The model says the utterance asks for more after this step. */
    more: boolean
    page: PageContext
  }

  /**
   * One question to the model: the page as it is now (with the box as it was before the utterance
   * when baseText is given), the tabs, the lines before this utterance and the steps already taken
   * for it. Null when the model gave no answer (the caller keeps what the rules did).
   */
  const askOnce = async (utterance: string, box: BoxState, baseText: string | null, recentBefore: string[], steps: IntentStep[]): Promise<Heard | null> => {
    const page = await readPage(box, baseText)
    const tabs = await deps.tabs().catch((): TabSummary[] => [])
    const request: IntentRequest = { lang: deps.lang, utterance, page, tabs, recent: recentBefore }
    if (steps.length > 0) request.steps = steps
    const answer = await askWithTimeout(request)
    if ('error' in answer) {
      if (answer.error === 'no_model') setModelOff(true)
      return null
    }
    setModelOff(false)
    const intent = deps.logic.pageIntentFrom(answer.intent, { page, tabs }) ?? { kind: 'unclear', say: '' }
    return { intent, say: answer.say, more: answer.done === false, page }
  }

  /** How one step went, for the strip and for the model's next look. */
  interface Outcome {
    ok: boolean
    /** The strip's line about it. */
    line: string
  }

  /**
   * Runs one step: its commands in order through the page, stopping at the first failure, and
   * inpageResult for the line and the session (hints, undo). u: the live utterance whose preview
   * may still be in the box; a step without a setText puts the base back first.
   */
  const perform = async (step: InpageStep, u: Live | null): Promise<Outcome> => {
    session = step.session
    say(step.line)
    // A command, or nothing at all: the preview must not stay in the box.
    if (u !== null && !step.commands.some((c) => c.kind === 'setText')) await takeBack(u)
    if (step.commands.length === 0) return { ok: true, line: step.line }
    let last: BrowserResult = { ok: true }
    for (const command of step.commands) {
      last = await runSafe(command)
      if (!last.ok) break
    }
    const after = deps.logic.inpageResult(session, step.commands, last)
    session = after.session
    const line = after.line !== '' ? after.line : step.line
    say(line)
    return { ok: last.ok, line }
  }

  /** The step for the model, e.g. "command goTo", "command clickItem 12", "edit undo", "send". */
  const kindSummary = (intent: PageIntent): string => {
    switch (intent.kind) {
      case 'command': {
        const c = intent.command
        const detail = c.kind === 'clickItem' || c.kind === 'focusItem' ? ` ${c.id}` : c.kind === 'clickHint' ? ` ${c.number}` : ''
        return `command ${c.kind}${detail}`
      }
      case 'edit':
        return `edit ${intent.edit.kind}`
      default:
        return intent.kind
    }
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

  /**
   * M7.2: runs the model's step and, while the model says the utterance asks for more, looks at
   * the page again and asks again with the steps taken so far. Bounded: MAX_INTENT_STEPS steps,
   * INTENT_LOOP_BUDGET_MS since the utterance arrived, MAX_STEP_FAILURES failed steps, and an
   * unclear answer stops it. Everything runs through perform, so the session stays true.
   */
  const follow = async (utterance: string, box: BoxState, recentBefore: string[], first: Heard, arrived: number, u: Live | null): Promise<void> => {
    let heard = first
    let steps: IntentStep[] = []
    let failures = 0
    for (;;) {
      const step = deps.logic.applyIntent(session, heard.intent, heard.page, heard.say)
      const outcome = await perform(step, u)
      u = null
      if (heard.intent.kind === 'unclear') return
      // A step with nothing to run did nothing: the model hears that, not a success.
      const ok = outcome.ok && step.commands.length > 0
      if (!ok) failures += 1
      steps = [...steps, { action: kindSummary(heard.intent), say: heard.say, ok, message: ok ? '' : outcome.line }]
      // A failed step is asked about once more even when the model thought it was done: the
      // model could not know the click would miss, and the steps now say so.
      if ((!heard.more && ok) || steps.length >= MAX_INTENT_STEPS || failures >= MAX_STEP_FAILURES) return
      if (Date.now() - arrived > INTENT_LOOP_BUDGET_MS) return
      await settle()
      const next = await askOnce(utterance, box, null, recentBefore, steps)
      if (next === null) return
      heard = next
    }
  }

  const handle = async (utterance: string, u: Live | null): Promise<void> => {
    const arrived = Date.now()
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
    const before = session
    const recentBefore = recent
    const rules = deps.logic.inpageStep(session, utterance, box)
    // Dictation by the rules: a short utterance, or one with no armed box, may mean something else.
    const shouldAsk = rules.ask === true && (!box.armed || wordCount(utterance) < LONG_UTTERANCE_WORDS)
    if (!shouldAsk) {
      await perform(rules, u)
      return
    }
    if (box.armed) {
      // Type first, verify after: the words are in the box at once, and the model only takes
      // them back when it is sure they were something else.
      const typed = await perform(rules, u)
      deps.publish({ thinking: true })
      try {
        const heard = await askOnce(utterance, box, box.text, recentBefore, [])
        if (heard === null || heard.intent.kind === 'dictate' || heard.intent.kind === 'unclear') return
        // The rules' typing is taken back: the session from before it, and the base in the box.
        session = before
        if (typed.ok) await runSafe({ kind: 'setText', text: box.text })
        await follow(utterance, box, recentBefore, heard, arrived, null)
      } finally {
        deps.publish({ thinking: false })
      }
      return
    }
    // Nothing was typed, so there is nothing to show yet: wait for the model.
    deps.publish({ thinking: true, line: inpageText.thinking })
    try {
      const heard = await askOnce(utterance, box, box.text, recentBefore, [])
      if (heard === null) {
        await perform(rules, u)
        return
      }
      await follow(utterance, box, recentBefore, heard, arrived, u)
    } finally {
      deps.publish({ thinking: false })
    }
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
        // A step that throws must not stop every utterance after it: the queue stays a resolved promise.
        queue = queue.then(() => handle(utterance, u)).catch(() => undefined)
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

  // Once: the strip tells him before he speaks when the server has no model.
  queue = queue.then(async () => {
    const status = await deps.status().catch((): 'unreachable' => 'unreachable')
    modelOff = status === 'no_key'
    deps.publish({ modelProblem: modelOff ? inpageText.modelOff : '' })
  })

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
    flush() {
      recognizer.flush?.()
    },
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
