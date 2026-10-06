// The in-page engine (docs/ARCHITECTURE.md 21.2, 21.3): one recogniser and one InpageSession for
// the whole browser. No chrome.* here: the offscreen document wires it to the service worker, and
// the unit test wires it to fakes.

import type { BoxState, BrowserCommand, BrowserResult, PageContext } from '../../src/browser/protocol.ts'
import type { InpageSession, InpageStep } from '../../src/core/inpage.ts'
import { chainLine, firstGoal, hasConnective } from '../../src/core/chain.ts'
import type { IntentAnswer, IntentChain, IntentRequest, IntentStep, PageIntent, TabSummary } from '../../src/core/pageIntent.ts'
import { MAX_CHAIN_MS, MAX_CHAIN_STEPS, MAX_INTENT_STEPS } from '../../src/core/pageIntent.ts'
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

/**
 * The recogniser's handlers as the engine gives them: onLag (round 3) and onUtteranceContinued
 * (round 4) are always there, whether or not the recogniser calls them.
 */
export type EngineHandlers = RecognizerHandlers & {
  onLag(ms: number): void
  onUtteranceContinued(text: string, added: string): void
  /** Round 4 (review): a foreign final takes back the preview its partials typed. */
  onForeign(): void
  /** Round 4 (review): enrolment is over; utterances are handled again. */
  onEnrolled(ok: boolean, seconds: number): void
}

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
  /**
   * Round 4 (review): learns the owner's voice from the next `seconds` of speech. Listening starts
   * if it was off; what he says meanwhile is neither typed nor run, until the server answers (or
   * ENROL_TIMEOUT_FACTOR × seconds have passed).
   */
  enrol(seconds: number): void
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
/** Round 4: a chain of commands can be long, so almost every dictation is verified (type first, verify after). */
export const LONG_UTTERANCE_WORDS = 60
/** The model must answer within this time, or the rules' step stands. */
/** Longer than the server's own 7 s, so a slow model answers 504 and the engine sees it rather than giving up first. */
export const ASK_TIMEOUT_MS = 9000
/** Round 5: a careful ask (server timeout 12 s) may take this long before the engine gives it up. */
export const ASK_TIMEOUT_CAREFUL_MS = 14_000
/** Round 5: how long the engine waits for one ask, by its care. */
export const askTimeoutMs = (care: Care | undefined): number => (care === 'careful' ? ASK_TIMEOUT_CAREFUL_MS : ASK_TIMEOUT_MS)
type Care = NonNullable<IntentRequest['care']>
/**
 * Round 5: an utterance of this many words or more is asked with care (the model reads the whole
 * of it and plans before it acts); so is one with a connective in it, and every ask in a chain.
 * Shorter ones are asked quickly, so a short command keeps its speed.
 */
export const CAREFUL_WORDS = 8
/**
 * Round 5: a job (one utterance's turn, or one goal of its chain) that is still working this long
 * after it began is given up as a barge-in would give it up, and the strip says so. Nothing can
 * sit silent for minutes.
 */
export const JOB_WATCHDOG_MS = 25_000
/** Round 5: one page command gets this long to answer, else it failed with 'timed_out' (the bridge's own cap is 20 s too). */
export const COMMAND_TIMEOUT_MS = 20_000
/** Round 5: the strip shows how long a job has been working from this many seconds on. */
export const BUSY_FROM_S = 3
/**
 * Round 5 (review of round 4, M7): a dictation of this many words or more, typed first, is never
 * taken back for a verdict that is one plain command with nothing after it: a 14-word single
 * command is implausible, and a wrong verdict would erase a sentence. Chains carry a plan or
 * done:false, so they still run.
 */
export const LONG_COMMAND_WORDS = 14
/** How many strip lines the model is told about, and how long each may be (IntentRequestSchema: 200). */
const RECENT_LINES = 3
/** M7.2: a multi-step utterance gets no further step once this long has passed since it arrived. */
export const INTENT_LOOP_BUDGET_MS = 15_000
/**
 * Round 3: an utterance that waited longer than this in the queue is handled by the rules alone,
 * with no question to the model: an answer minutes late would act on a page that has changed.
 */
export const STALE_MS = 3000
/**
 * Round 3: the recogniser's lag is shown on the strip from this much on, and cleared below it. Below
 * the server's MAX_BACKLOG_MS (1500): the server reports the backlog at the moment it drops, which is
 * never much above that, so a higher threshold would hide every drop.
 */
export const LAG_SHOWN_MS = 1000
/** M7.2: the loop stops after this many failed steps (one failure is reported back so the model may recover). */
export const MAX_STEP_FAILURES = 2
/** M7.2: how long the page gets to render after a step before it is read again (a goTo already waited for the load). */
export const SETTLE_MS = 300
/** Round 4: the model may plan this many goals after the one it acts on (IntentAnswerSchema: 12). */
const MAX_PLAN_GOALS = 12
const GOAL_CHARS = 200
/** IntentRequestSchema's utterance limit: a longer one would be a 400, and the words never judged. */
const UTTERANCE_CHARS = 500
/** Round 4 (review): an enrolment with no answer from the server ends after this many times its seconds. */
export const ENROL_TIMEOUT_FACTOR = 5
const RECENT_LINE_CHARS = 200
/** The request's limits in IntentRequestSchema: a page beyond them would be a 400, and the model never asked. */
const URL_CHARS = 2000
const TITLE_CHARS = 300
const BOX_CHARS = 4000

const wordCount = (utterance: string): number => utterance.trim().split(/\s+/).filter((w) => w !== '').length
/** Lower case, letters and digits only: for telling one goal from another however the model spelt it. */
const sameGoal = (a: string, b: string): boolean => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** Goals as the chain carries them: each clipped to the schema's length, at most MAX_PLAN_GOALS, the newest kept. */
const clipGoals = (goals: readonly string[]): string[] => goals.map((g) => g.slice(0, GOAL_CHARS)).slice(-MAX_PLAN_GOALS)

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
  /**
   * Round 4: the goals the last utterance finished, in his words, so a continued utterance
   * ("siis ava Karin") can carry them as `completed`.
   */
  let lastDone: string[] = []

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

  /** One page command, never longer than COMMAND_TIMEOUT_MS (round 5): a page that never answers must not hold the engine. */
  const runSafe = async (command: BrowserCommand): Promise<BrowserResult> => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const timedOut = new Promise<BrowserResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, code: 'failed', message: 'timed_out' }), COMMAND_TIMEOUT_MS)
    })
    try {
      return await Promise.race([deps.run(command), timedOut])
    } catch (error) {
      return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
    } finally {
      if (timer !== null) clearTimeout(timer)
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
    /**
     * Round 4: the chain of goals this utterance is working through, once the model has planned
     * one (or, for a continued utterance, from the start). Null for a single goal.
     */
    chain: IntentChain | null
    /**
     * Round 4: a continued utterance ("siis ava Karin" soon after the last one): it does not barge
     * in, waits for every verification like a send, and is never stale.
     */
    continued: boolean
    /** Round 5: Date.now() when the job began working (its turn, or its verification); null before and once given up. */
    started: number | null
    /** Round 5: the watchdog for the goal in hand, while one is set. */
    watchdog: ReturnType<typeof setTimeout> | null
    /** Round 5: "katkesta": the job does nothing more, not even the rules' step. */
    dropped: boolean
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

  const showThinking = (): void => {
    const now = thinkingCount > 0
    if (now === thinkingShown) return
    thinkingShown = now
    deps.publish({ thinking: now })
  }

  /** Round 5: clamped at 0, so a reset while questions are in flight never leaves the dots on. */
  const think = (on: boolean): void => {
    thinkingCount = Math.max(0, thinkingCount + (on ? 1 : -1))
    showThinking()
  }

  /** Round 5: a cancel or a watchdog clears the dots whatever is in flight; the jobs' own decrements then clamp at 0. */
  const resetThinking = (): void => {
    thinkingCount = 0
    showThinking()
  }

  // ---- Round 5: busy seconds. While any job works, the strip shows the elapsed seconds from BUSY_FROM_S on. ----
  let busyShown = 0
  let busyTimer: ReturnType<typeof setInterval> | null = null
  const publishBusy = (seconds: number): void => {
    if (seconds === busyShown) return
    busyShown = seconds
    deps.publish({ busySeconds: seconds })
  }
  const busyTick = (): void => {
    const now = Date.now()
    let longest = 0
    for (const job of jobs) if (job.started !== null) longest = Math.max(longest, now - job.started)
    const seconds = Math.floor(longest / 1000)
    publishBusy(seconds >= BUSY_FROM_S ? seconds : 0)
  }
  const anyWorking = (): boolean => [...jobs].some((job) => job.started !== null)
  const busyCheck = (): void => {
    if (anyWorking()) {
      if (busyTimer === null) busyTimer = setInterval(busyTick, 1000)
    } else {
      if (busyTimer !== null) clearInterval(busyTimer)
      busyTimer = null
      publishBusy(0)
    }
  }
  // ---- end of busy seconds ----

  const newJob = (utterance: string, send: boolean): Job => {
    const job: Job = { utterance, arrived: Date.now(), send, interrupted: false, cancelled: false, controller: null, looping: false, verifying: false, acting: false, chain: null, continued: false, started: null, watchdog: null, dropped: false }
    jobs.add(job)
    return job
  }

  /** Round 4: the strip's chain line while a chain runs, '' once it is over. Published on change only. */
  let chainShown = ''
  const showChain = (chain: IntentChain | null): void => {
    const line = chain === null ? '' : chainLine(chain)
    if (line === chainShown) return
    chainShown = line
    deps.publish({ chain: line })
  }

  // ---- Round 5: the watchdog. A job that works JOB_WATCHDOG_MS without finishing its goal is given up. ----
  const unwatch = (job: Job): void => {
    if (job.watchdog !== null) clearTimeout(job.watchdog)
    job.watchdog = null
  }
  /** Gives the job up as a barge-in would: the question in flight, the loop and the chain end; the page command in hand finishes. */
  const giveUp = (job: Job): void => {
    job.interrupted = true
    job.cancelled = true
    job.controller?.abort()
    job.started = null
    unwatch(job)
  }
  const tookTooLong = (job: Job): void => {
    if (!jobs.has(job) || job.cancelled) return
    job.dropped = true
    giveUp(job)
    if (job.chain !== null) showChain(null)
    resetThinking()
    busyCheck()
    say(inpageText.tookTooLong)
  }
  /** (Re)starts the job's watchdog: at its turn, and at every goal of its chain. */
  const watch = (job: Job): void => {
    unwatch(job)
    job.watchdog = setTimeout(() => tookTooLong(job), JOB_WATCHDOG_MS)
  }
  /** The job begins working: it is counted as busy and watched. */
  const beginWork = (job: Job): void => {
    job.started = Date.now()
    watch(job)
    busyCheck()
  }
  /** The job is over, however it ended. */
  const endWork = (job: Job): void => {
    unwatch(job)
    job.started = null
    jobs.delete(job)
    busyCheck()
  }
  // ---- end of the watchdog ----

  /** The rules' step for an utterance against the probe box. Pure: the probe box is never typed into. Null when the rules throw. */
  const probe = (utterance: string): InpageStep | null => {
    try {
      return deps.logic.inpageStep(session, utterance, SEND_PROBE_BOX)
    } catch {
      return null
    }
  }

  /** The rules alone say whether an utterance is a plain send, before its turn comes. */
  const isPlainSend = (utterance: string): boolean => {
    const step = probe(utterance)
    return step !== null && step.commands.length === 1 && step.commands[0]?.kind === 'pressSend'
  }

  /** Round 5: the rules say the utterance is the global cancel ("katkesta"). */
  const isCancelAll = (utterance: string): boolean => probe(utterance)?.cancel === true

  /**
   * Round 5: "katkesta": every job is given up, the queued ones do nothing at all, the live
   * preview is taken back, and the strip's dots, seconds and chain line go. The model is not asked.
   */
  const cancelAll = (): void => {
    for (const job of jobs) {
      job.dropped = true
      giveUp(job)
    }
    dropLive()
    showChain(null)
    resetThinking()
    busyCheck()
  }

  /** Round 5: how hard the model should think about this job's ask. */
  const careOf = (job: Job): Care => (job.chain !== null || wordCount(job.utterance) >= CAREFUL_WORDS || hasConnective(job.utterance) ? 'careful' : 'quick')

  /**
   * Barge-in (round 3): a new utterance stops the model work of every earlier one at the next
   * safe point. A plain send is the exception: it waits for a verification instead of cancelling
   * it (nothing is sent while the box is being judged), but a multi-step loop is still given up.
   */
  const interrupt = (newcomer: Job): void => {
    for (const job of jobs) {
      if (job === newcomer) continue
      if (newcomer.send && job.verifying && !job.acting) continue
      // Round 4: a plain send does not cancel a chain of goals; it waits its turn behind it.
      if (newcomer.send && job.chain !== null) continue
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
      }, askTimeoutMs(request.care))
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
    /** Round 4: the goals after the one this step serves, in his words. Empty for one goal. */
    plan: string[]
    page: PageContext
  }

  /** The model's plan as a clean list: strings only, trimmed, no empties, clipped to the schema's limits. */
  const planFrom = (answer: IntentAnswer): string[] =>
    (Array.isArray(answer.plan) ? answer.plan : [])
      .filter((goal): goal is string => typeof goal === 'string')
      .map((goal) => goal.trim().slice(0, GOAL_CHARS))
      .filter((goal) => goal !== '')
      .slice(0, MAX_PLAN_GOALS)

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
    // Round 4: in a chain the model is asked about the goal in hand, and told the chain.
    const chain = job.chain
    const request: IntentRequest = { lang: deps.lang, utterance: (chain === null ? job.utterance : chain.goal).slice(0, UTTERANCE_CHARS), page, tabs, recent: recentBefore, care: careOf(job) }
    if (steps.length > 0) request.steps = steps
    if (chain !== null) request.chain = chain
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
    return { intent, say: answer.say, more: answer.done === false, plan: planFrom(answer), page }
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
  const perform = async (step: InpageStep, u: Live | null, suffix = '', job: Job | null = null): Promise<Outcome> => {
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
    // Round 5: a job given up meanwhile ("katkesta", the watchdog) keeps that line, not this late result.
    if (job?.dropped !== true) say(withSuffix(line))
    return { ok: last.ok, line }
  }

  /** The step for the model, e.g. "command goTo", "command clickItem 12", "edit undo", "send". */
  const kindSummary = (intent: PageIntent): string => {
    switch (intent.kind) {
      case 'command': {
        const c = intent.command
        const withId = c.kind === 'clickItem' || c.kind === 'focusItem' || c.kind === 'hover' || c.kind === 'contextMenu' || c.kind === 'scrollTo'
        const detail = withId ? ` ${c.id}` : c.kind === 'clickHint' ? ` ${c.number}` : ''
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
   * Round 4: the model planned goals after the one its action serves. With no chain yet, the
   * chain starts: the goal is the part of the utterance the action served (firstGoal). In a chain,
   * a plan on a goal's first ask means the goal itself held several parts ("siis ava Karin ja
   * kustuta see"): the goal narrows to its first part and the rest go before what remained.
   */
  const planChain = (job: Job, heard: Heard, firstAskOfGoal: boolean): void => {
    if (heard.plan.length === 0 || !firstAskOfGoal) return
    const chain = job.chain
    if (chain === null) {
      const goal = firstGoal(job.utterance, heard.plan, heard.say)
      // Review: a plan that repeats the whole utterance or the goal in hand would ask the same thing
      // again until MAX_CHAIN_STEPS; such goals, and duplicates, are not goals.
      const remaining = heard.plan.filter((g, i) => !sameGoal(g, goal) && !sameGoal(g, job.utterance) && heard.plan.findIndex((h) => sameGoal(h, g)) === i)
      if (remaining.length === 0) return
      job.chain = { original: job.utterance.slice(0, 1000), completed: [], goal, remaining }
    } else {
      const goal = firstGoal(chain.goal, heard.plan, heard.say)
      const known = [...chain.completed, goal, chain.goal, chain.original, ...chain.remaining]
      const fresh = heard.plan.filter((g, i) => !known.some((k) => sameGoal(k, g)) && heard.plan.findIndex((h) => sameGoal(h, g)) === i)
      if (fresh.length === 0) return
      job.chain = { ...chain, goal, remaining: [...fresh, ...chain.remaining].slice(0, MAX_PLAN_GOALS) }
    }
    showChain(job.chain)
  }

  /** How one goal's loop ended: done (the chain may go on), or stopped for good. */
  type GoalEnd = 'done' | 'stopped'

  /**
   * M7.2: runs the model's step and, while the model says the goal asks for more, looks at the
   * page again and asks again with the steps taken so far. Bounded: maxSteps steps (MAX_INTENT_STEPS,
   * or what the chain has left), INTENT_LOOP_BUDGET_MS since `since`, MAX_STEP_FAILURES failed
   * steps, an unclear answer stops it, and so does a later utterance (round 3: the step in hand
   * finishes, no further one is asked for; the strip keeps that step's line). Everything runs
   * through perform, so the session stays true. Round 4: an unclear after a good step ("Valmis")
   * ends the goal as done; `taken` counts the steps run, for the chain's total.
   */
  const runGoal = async (job: Job, box: BoxState, recentBefore: string[], first: Heard, u: Live | null, since: number, maxSteps: number, taken: { n: number }): Promise<GoalEnd> => {
    let heard = first
    let steps: IntentStep[] = []
    let failures = 0
    for (;;) {
      planChain(job, heard, steps.length === 0)
      const step = deps.logic.applyIntent(session, heard.intent, heard.page, heard.say)
      const outcome = await perform(step, u, '', job)
      u = null
      if (job.dropped) return 'stopped'
      if (heard.intent.kind === 'unclear') return steps.some((s) => s.ok) ? 'done' : 'stopped'
      // A step with nothing to run did nothing: the model hears that, not a success.
      const ok = outcome.ok && step.commands.length > 0
      if (!ok) failures += 1
      taken.n += 1
      steps = [...steps, { action: kindSummary(heard.intent), say: heard.say, ok, message: ok ? '' : outcome.line }]
      if (!heard.more && ok) return 'done'
      // A failed step is asked about once more even when the model thought it was done: the
      // model could not know the click would miss, and the steps now say so.
      if (steps.length >= maxSteps || failures >= MAX_STEP_FAILURES) return 'stopped'
      if (job.interrupted) return 'stopped'
      if (Date.now() - since > INTENT_LOOP_BUDGET_MS) return 'stopped'
      await settle()
      if (job.interrupted) return 'stopped'
      job.looping = true
      const next = await askOnce(job, box, null, recentBefore, steps)
      if (next === null) return 'stopped'
      heard = next
    }
  }

  /**
   * Round 4: works through the utterance's goals. The first goal runs as M7.2's loop; when the
   * model's answer carried a plan the chain starts, and each goal done shifts to the next: asked
   * afresh with that goal as the utterance, the chain in the request, and the steps reset. It
   * stops when nothing remains, after MAX_CHAIN_STEPS page steps in all, after MAX_CHAIN_MS since
   * the utterance arrived, on unclear, on two failed steps for one goal, when the model cannot be
   * reached, and on barge-in (a later utterance; a plain send only waits). The chain line on the
   * strip is published on every shift and cleared when the chain ends, however it ends.
   */
  const follow = async (job: Job, box: BoxState, recentBefore: string[], first: Heard, u: Live | null): Promise<void> => {
    const started = job.arrived
    const taken = { n: 0 }
    let heard = first
    let since = job.arrived
    if (job.chain !== null) showChain(job.chain)
    try {
      for (;;) {
        const end = await runGoal(job, box, recentBefore, heard, u, since, Math.min(MAX_INTENT_STEPS, MAX_CHAIN_STEPS - taken.n), taken)
        u = null
        const chain = job.chain
        if (end !== 'done' || chain === null) break
        const [goal, ...remaining] = chain.remaining
        if (goal === undefined) break
        if (taken.n >= MAX_CHAIN_STEPS || Date.now() - started > MAX_CHAIN_MS || job.interrupted) break
        job.chain = { ...chain, completed: clipGoals([...chain.completed, chain.goal]), goal, remaining }
        showChain(job.chain)
        await settle()
        if (job.interrupted) break
        job.looping = true
        since = Date.now()
        // Round 5: the watchdog is per goal, so a long chain is never given up while it moves.
        watch(job)
        const next = await askOnce(job, box, null, recentBefore, [])
        if (next === null) break
        heard = next
      }
    } finally {
      // Review: the chain line goes on every exit, a thrown step included.
      const chain = job.chain
      lastDone = clipGoals(chain === null ? [job.utterance] : [...chain.completed, chain.goal])
      if (chain !== null) showChain(null)
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
    job.chain = from.chain
    job.continued = from.continued
    let done = (): void => undefined
    const p = new Promise<void>((resolve) => {
      done = resolve
    })
    pending.add(p)
    void (async () => {
      think(true)
      beginWork(job)
      try {
        const heard = await askOnce(job, box, box.text, recentBefore, [])
        if (heard === null || heard.intent.kind === 'dictate' || heard.intent.kind === 'unclear') return
        // Round 5 (review M7): a long sentence judged one plain command with nothing after it stays.
        if (heard.intent.kind === 'command' && !heard.more && heard.plan.length === 0 && wordCount(job.utterance) >= LONG_COMMAND_WORDS) {
          say(inpageText.keptWords)
          return
        }
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
        endWork(job)
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
      await settled(job.send || job.continued ? pending : acting)
      beginWork(job)
      // Round 5: "katkesta" came while this one waited: nothing of it runs, its preview goes.
      if (job.dropped) {
        if (u !== null) await takeBack(u)
        return
      }
      // Round 4: a continued utterance carries what the last one finished as its completed goals.
      if (job.continued && job.chain !== null) job.chain = { ...job.chain, completed: clipGoals(lastDone) }
      let box: BoxState
      if (u === null) {
        box = await readBox()
      } else {
        u.over = true
        await u.ready
        if (u.typing !== null) await u.typing
        // The base, never the box as it reads now: that holds the preview. A plain send typed no
        // preview and waited for the chain or verification before it, which may have armed or filled
        // the box since the base was read (review): it reads the box as it is now.
        box = job.send ? await readBox() : (u.base ?? NO_BOX)
      }
      const before = session
      const recentBefore = recent
      const rules = deps.logic.inpageStep(session, job.utterance, box)
      // Waited too long in the queue: the rules alone, and the strip says so (round 3). A continued
      // utterance meant to wait for the chain before it (round 4) is never stale.
      const stale = Date.now() - job.arrived > STALE_MS && !job.continued
      // Dictation by the rules: a short utterance, or one with no armed box, may mean something else.
      const shouldAsk = rules.ask === true && (!box.armed || wordCount(job.utterance) < LONG_UTTERANCE_WORDS) && !stale && !job.cancelled
      if (!shouldAsk) {
        await perform(rules, u, stale ? inpageText.catchingUp : '', job)
        lastDone = clipGoals([job.utterance])
        return
      }
      // Round 5: a single-line field (a form's name, email, code) is verified before anything is typed.
      const single = box.single === true
      if (box.armed && !single) {
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
      deps.publish({ line: careOf(job) === 'careful' ? inpageText.thinkingLong : inpageText.thinking })
      try {
        const heard = await askOnce(job, box, box.text, recentBefore, [])
        if (job.dropped) {
          if (u !== null) await takeBack(u)
          return
        }
        if (heard === null) {
          // A single-line field with a model that gave no answer gets nothing typed (round 5); the
          // rules' step stands everywhere else, and where there is no model at all.
          if (single && box.armed && !modelOff) {
            if (u !== null) await takeBack(u)
            say(inpageText.fieldUnverified)
            return
          }
          await perform(rules, u)
          return
        }
        // Review of round 5: in a field he armed himself, a model that cannot tell leaves the
        // typing to the rules, as type-first does everywhere else; nothing is lost to "ei saanud aru".
        if (single && box.armed && heard.intent.kind === 'unclear' && heard.plan.length === 0) {
          await perform(rules, u, '', job)
          return
        }
        await follow(job, box, recentBefore, heard, u)
      } finally {
        think(false)
      }
    } finally {
      endWork(job)
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

  /**
   * Round 4 (review): while the server learns his voice he speaks eight seconds of anything; those
   * words are neither typed nor run. Cleared by onEnrolled, or by a timer when no answer comes.
   */
  let enrolTimer: ReturnType<typeof setTimeout> | null = null
  let enrolling = false
  const endEnrolment = (): void => {
    if (enrolTimer !== null) clearTimeout(enrolTimer)
    enrolTimer = null
    enrolling = false
  }

  /** The utterance in progress ends with no final: its preview goes, when it typed one. */
  const dropLive = (): void => {
    const u = live
    live = null
    if (u === null) return
    u.over = true
    queue = queue.then(() => takeBack(u))
  }

  const handlers: EngineHandlers = {
    onUtterance(utterance) {
      if (enrolling) return
      deps.publish({ heard: utterance })
      // Round 5: "katkesta" drops everything at once, in the handler, and asks nobody.
      if (isCancelAll(utterance)) {
        cancelAll()
        say(inpageText.cancelled)
        return
      }
      const u = live
      live = null
      if (u !== null) u.over = true
      const job = newJob(utterance, isPlainSend(utterance))
      interrupt(job)
      // A step that throws must not stop every utterance after it: the queue stays a resolved promise.
      queue = queue.then(() => handle(job, u)).catch(() => undefined)
    },
    onUtteranceContinued(text, added) {
      if (enrolling) return
      // Round 4: "siis ava Karin" soon after the last utterance goes on from it: no barge-in, and
      // the new words are asked as the next goal of the chain the last utterance was.
      deps.publish({ heard: text })
      const u = live
      live = null
      if (u !== null) u.over = true
      const job = newJob(added, false)
      job.continued = true
      job.chain = { original: text.slice(0, 1000), completed: [], goal: added.slice(0, GOAL_CHARS), remaining: [] }
      queue = queue.then(() => handle(job, u)).catch(() => undefined)
    },
    onInterim(interim) {
      // An empty interim keeps the last words on the strip until new speech arrives.
      if (interim === '' || enrolling) return
      deps.publish({ heard: interim })
      if (!listening) return
      const u = live ?? begin()
      live = u
      u.partial = interim
      type(u)
    },
    onError() {
      listening = false
      endEnrolment()
      deps.publish({ listening: false, problem: text.micBlocked })
      deps.micBlocked()
    },
    onNotice() {
      // The local recogniser has no fallback here; nothing to show.
    },
    onForeign() {
      // Round 4 (review): someone else's final was dropped; the preview its partials typed must not
      // sit in his box until he next speaks (he may not). Taken back like a stopped utterance.
      dropLive()
    },
    onEnrolled() {
      endEnrolment()
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
      endEnrolment()
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
    dropLive()
    endEnrolment()
    // The server sends no lag of 0 once the socket is gone: the line is cleared here.
    if (lagShown) {
      lagShown = false
      deps.publish({ listening: false, lag: 0 })
    } else deps.publish({ listening: false })
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
    enrol(seconds) {
      if (!recognizer.enrol) return
      if (!listening) start()
      dropLive()
      endEnrolment()
      enrolling = true
      enrolTimer = setTimeout(endEnrolment, seconds * 1000 * ENROL_TIMEOUT_FACTOR)
      recognizer.enrol(seconds)
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
