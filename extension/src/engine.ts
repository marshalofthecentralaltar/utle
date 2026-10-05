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

/**
 * Why the model gave no answer: no key on the server, the server cannot be reached, an answer of
 * the wrong shape, or the engine itself gave the question up (barge-in, round 3).
 */
export type AskFailure = { error: 'no_model' | 'unreachable' | 'bad' | 'aborted' }

/** The recogniser's handlers as the engine gives them: onLag (round 3) is always there, whether or not the recogniser calls it. */
export type EngineHandlers = RecognizerHandlers & { onLag(ms: number): void }

export interface EngineDeps {
  logic: InpageLogic
  lang: Lang
  /** Runs one command on the page in front. Never rejects with a reason the engine must know. */
  run(command: BrowserCommand): Promise<BrowserResult>
  publish(patch: Partial<StripState>): void
  /** Makes the recogniser. onUnavailable: the speech model cannot be reached. The handlers carry onLag (round 3). */
  recognizer(handlers: EngineHandlers, isInstant: (text: string) => boolean, onUnavailable: () => void): Recognizer
  /** The microphone was refused or is missing. */
  micBlocked(): void
  /**
   * M7: asks the model (POST /api/intent) what an utterance meant on this page. Never rejects.
   * Round 3: signal is aborted when the engine no longer wants the answer (a later utterance
   * arrived, or the timeout passed); the fetch should end with it.
   */
  ask(request: IntentRequest, signal: AbortSignal): Promise<IntentAnswer | AskFailure>
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
/**
 * Round 3: the box the rules are shown to tell a plain send ("saada") from everything else before
 * the utterance's turn comes. Exported so a test's logic can recognise the probe.
 */
export const SEND_PROBE_BOX: BoxState = { present: true, text: 'x', armed: true }

/** The model is not asked about an utterance this long when the box is armed: a sentence is dictation. */
export const LONG_UTTERANCE_WORDS = 14
/** The model must answer within this time, or the rules' step stands. */
/** Longer than the server's own 7 s, so a slow model answers 504 and the engine sees it rather than giving up first. */
export const ASK_TIMEOUT_MS = 9000
/** How many strip lines the model is told about, and how long each may be (IntentRequestSchema: 200). */
const RECENT_LINES = 3
/** M7.2: a multi-step utterance gets no further step once this long has passed since it arrived. */
export const INTENT_LOOP_BUDGET_MS = 15_000
/**
 * Round 3: an utterance that waited longer than this in the queue is handled by the rules alone,
 * with no question to the model: an answer minutes late would act on a page that has changed.
 */
export const STALE_MS = 3000
/** Round 3: the recogniser's lag is shown on the strip from this much on, and cleared below it. */
export const LAG_SHOWN_MS = 2000
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

  /**
   * Round 3: one utterance's model work. A later utterance interrupts it (no further step after
   * the page command in hand) and, unless the later one is a plain send waiting for a
   * verification, cancels it (the question in flight is given up).
   */
  interface Job {
    utterance: string
    /** Date.now() when the utterance arrived from the recogniser. */
    arrived: number
    /** The rules took it for a plain send ("saada"): it waits for every verification pending. */
    send: boolean
    /** A later utterance arrived: no further step is asked for. */
    interrupted: boolean
    /** The model is not asked (again) and the question in flight is given up. */
    cancelled: boolean
    /** Aborts the question in flight, while one is. */
    controller: AbortController | null
    /** Past its first step: in the multi-step loop. */
    looping: boolean
    /** A type-first verification: the words are in the box, the model judges them in the background. */
    verifying: boolean
    /** A verification whose verdict was a command: it is putting the box back and running it. */
    acting: boolean
  }

  /** Every job not finished: the one in its turn of the queue, those waiting for it, the verifications. */
  const jobs = new Set<Job>()
  /** The verifications in flight (round 3): a send waits for all of them before it sends. */
  const pending = new Set<Promise<void>>()
  /** Of those, the ones running page commands: the next utterance waits for them so commands do not interleave. */
  const acting = new Set<Promise<void>>()
  /** How many questions to the model are in flight; thinking is shown while any is. */
  let thinkingCount = 0
  let thinkingShown = false
  let lagShown = false

  const think = (on: boolean): void => {
    thinkingCount += on ? 1 : -1
    const now = thinkingCount > 0
    if (now === thinkingShown) return
    thinkingShown = now
    deps.publish({ thinking: now })
  }

  const newJob = (utterance: string, send: boolean): Job => {
    const job: Job = { utterance, arrived: Date.now(), send, interrupted: false, cancelled: false, controller: null, looping: false, verifying: false, acting: false }
    jobs.add(job)
    return job
  }

  /** The rules alone say whether an utterance is a plain send, before its turn comes. Pure: the probe box is never typed into. */
  const isPlainSend = (utterance: string): boolean => {
    try {
      const step = deps.logic.inpageStep(session, utterance, SEND_PROBE_BOX)
      return step.commands.length === 1 && step.commands[0]?.kind === 'pressSend'
    } catch {
      return false
    }
  }

  /**
   * Barge-in (round 3): a new utterance stops the model work of every earlier one at the next
   * safe point. A plain send is the exception: it waits for a verification instead of cancelling
   * it (nothing is sent while the box is being judged), but a multi-step loop is still given up.
   */
  const interrupt = (newcomer: Job): void => {
    for (const job of jobs) {
      if (job === newcomer) continue
      if (newcomer.send && job.verifying && !job.acting) continue
      job.interrupted = true
      if (!newcomer.send || job.looping) {
        job.cancelled = true
        job.controller?.abort()
      }
    }
  }

  const askWithTimeout = (request: IntentRequest, controller: AbortController): Promise<IntentAnswer | AskFailure> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        controller.abort()
        resolve({ error: 'unreachable' })
      }, ASK_TIMEOUT_MS)
      // The engine's own abort answers at once; the fetch ends on its own.
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve({ error: 'aborted' })
      })
      deps.ask(request, controller.signal).then(
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
   * for it. Null when the model gave no answer (the caller keeps what the rules did), or when the
   * job was cancelled by a later utterance.
   */
  const askOnce = async (job: Job, box: BoxState, baseText: string | null, recentBefore: string[], steps: IntentStep[]): Promise<Heard | null> => {
    if (job.cancelled) return null
    const page = await readPage(box, baseText)
    const tabs = await deps.tabs().catch((): TabSummary[] => [])
    if (job.cancelled) return null
    const request: IntentRequest = { lang: deps.lang, utterance: job.utterance, page, tabs, recent: recentBefore }
    if (steps.length > 0) request.steps = steps
    const controller = new AbortController()
    job.controller = controller
    const answer = await askWithTimeout(request, controller)
    job.controller = null
    if (job.cancelled) return null
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
   * may still be in the box; a step without a setText puts the base back first. suffix: added to
   * both lines (round 3: "Jõuan järele…" on a stale utterance).
   */
  const perform = async (step: InpageStep, u: Live | null, suffix = ''): Promise<Outcome> => {
    const withSuffix = (line: string): string => (suffix === '' || line === '' ? line : `${line} ${suffix}`)
    session = step.session
    say(withSuffix(step.line))
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
    say(withSuffix(line))
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
   * INTENT_LOOP_BUDGET_MS since the utterance arrived, MAX_STEP_FAILURES failed steps, an
   * unclear answer stops it, and so does a later utterance (round 3: the step in hand finishes,
   * no further one is asked for; the strip keeps that step's line). Everything runs through
   * perform, so the session stays true.
   */
  const follow = async (job: Job, box: BoxState, recentBefore: string[], first: Heard, u: Live | null): Promise<void> => {
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
      if (job.interrupted) return
      if (Date.now() - job.arrived > INTENT_LOOP_BUDGET_MS) return
      await settle()
      if (job.interrupted) return
      job.looping = true
      const next = await askOnce(job, box, null, recentBefore, steps)
      if (next === null) return
      heard = next
    }
  }

  /**
   * Round 3: the verification of a type-first dictation, in the background. The words are in the
   * box and the next utterance goes on; a send waits for this. A verdict of dictate or unclear, no
   * answer, or a cancellation leaves the words. A command: when the box still reads as the typing
   * left it, the typing is taken back (the session from before it, the base in the box) and the
   * command runs; when the box has changed since (more was typed, or the page changed it), nothing
   * is touched and the strip says the words were a command.
   */
  const verify = (from: Job, box: BoxState, before: InpageSession, typedSession: InpageSession, typed: Outcome, expected: string | null, recentBefore: string[]): void => {
    const job = newJob(from.utterance, false)
    job.verifying = true
    let done = (): void => undefined
    const p = new Promise<void>((resolve) => {
      done = resolve
    })
    pending.add(p)
    void (async () => {
      think(true)
      try {
        const heard = await askOnce(job, box, box.text, recentBefore, [])
        if (heard === null || heard.intent.kind === 'dictate' || heard.intent.kind === 'unclear') return
        job.acting = true
        acting.add(p)
        if (typed.ok && expected !== null) {
          const now = await readBox()
          if (now.text !== expected) {
            say(inpageText.lateCommand(job.utterance))
            return
          }
        }
        // The rules' typing is taken back: the session from before it (unless something since has
        // moved the session on), and the base in the box.
        if (session === typedSession) session = before
        if (typed.ok) await runSafe({ kind: 'setText', text: box.text })
        await follow(job, box, recentBefore, heard, null)
      } finally {
        think(false)
        jobs.delete(job)
        pending.delete(p)
        acting.delete(p)
        done()
      }
    })()
  }

  const settled = (set: Set<Promise<void>>): Promise<unknown> => Promise.all([...set])

  const handle = async (job: Job, u: Live | null): Promise<void> => {
    try {
      // A send waits for every verification: nothing is sent while the box is being judged. Any
      // other utterance waits only for a verification running page commands, so commands of two
      // utterances do not interleave.
      await settled(job.send ? pending : acting)
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
      const rules = deps.logic.inpageStep(session, job.utterance, box)
      // Waited too long in the queue: the rules alone, and the strip says so (round 3).
      const stale = Date.now() - job.arrived > STALE_MS
      // Dictation by the rules: a short utterance, or one with no armed box, may mean something else.
      const shouldAsk = rules.ask === true && (!box.armed || wordCount(job.utterance) < LONG_UTTERANCE_WORDS) && !stale && !job.cancelled
      if (!shouldAsk) {
        await perform(rules, u, stale ? inpageText.catchingUp : '')
        return
      }
      if (box.armed) {
        // Type first, verify after: the words are in the box at once, and the model only takes
        // them back when it is sure they were something else. The verification does not hold the
        // queue (round 3).
        const typed = await perform(rules, u)
        const typedSession = session
        const expected = rules.commands.reduce<string | null>((text, c) => (c.kind === 'setText' ? c.text : text), null)
        if (!job.cancelled) verify(job, box, before, typedSession, typed, expected, recentBefore)
        return
      }
      // Nothing was typed, so there is nothing to show yet: wait for the model.
      think(true)
      deps.publish({ line: inpageText.thinking })
      try {
        const heard = await askOnce(job, box, box.text, recentBefore, [])
        if (heard === null) {
          await perform(rules, u)
          return
        }
        await follow(job, box, recentBefore, heard, u)
      } finally {
        think(false)
      }
    } finally {
      jobs.delete(job)
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

  const handlers: EngineHandlers = {
    onUtterance(utterance) {
      deps.publish({ heard: utterance })
      const u = live
      live = null
      if (u !== null) u.over = true
      const job = newJob(utterance, isPlainSend(utterance))
      interrupt(job)
      // A step that throws must not stop every utterance after it: the queue stays a resolved promise.
      queue = queue.then(() => handle(job, u)).catch(() => undefined)
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
    onLag(ms) {
      // Round 3: how far behind the speech server is. Shown from LAG_SHOWN_MS, cleared once it is below.
      if (ms > LAG_SHOWN_MS) {
        lagShown = true
        deps.publish({ lag: ms })
      } else if (lagShown) {
        lagShown = false
        deps.publish({ lag: 0 })
      }
    },
  }

  const recognizer = deps.recognizer(
    handlers,
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
        if (pending.size > 0) {
          await settled(pending)
          continue
        }
        if (q === queue && (live?.typing ?? null) === null) return
      }
    },
  }
}
