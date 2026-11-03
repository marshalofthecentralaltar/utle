// The engine's types (docs/ARCHITECTURE.md 21.2): what createEngine takes and gives, and what its parts share.

import type { BoxState, BrowserCommand, BrowserResult, PageContext } from '../../../src/browser/protocol.ts'
import type { AddresseeAnswer, AddresseeRequest } from '../../../src/core/addressee.ts'
import type { InpageSession, InpageStep } from '../../../src/core/inpage.ts'
import type { IntentAnswer, IntentChain, IntentRequest, ModelIntent, PageIntent, RecentCommand, TabSummary } from '../../../src/core/pageIntent.ts'
import type { Place } from '../../../src/core/places.ts'
import type { SavedItem } from '../../../src/core/saved.ts'
import type { SpendRecord } from '../../../src/core/spend.ts'
import type { Lang, Strings } from '../../../src/core/strings.ts'
import type { Recognizer, RecognizerHandlers } from '../../../src/speech/recognizer.ts'
import type { SpeakerDecision, SpeakerReason } from '../../../src/speech/asrProtocol.ts'
import type { StripState } from '../messages.ts'
import type { Work } from './work.ts'

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
  pageIntentFrom(input: unknown, request: Pick<IntentRequest, 'page' | 'tabs'>): ModelIntent | null
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
  onUtteranceContinued(text: string, added: string, decision?: SpeakerDecision): void
  /** Round 4 (review): a foreign final takes back the preview its partials typed. Round 10 (31.7): reason, when the recogniser knows it. */
  onForeign(reason?: SpeakerReason): void
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
  /** M7: whether the server has a model, checked once when the engine starts. bad_token (27.3): it answered 401. */
  status(): Promise<'live' | 'no_key' | 'bad_token' | 'unreachable'>
  // ---------- document mode (29.2) ----------
  /**
   * Reads text aloud ("loe viimane lause ette"); onEnd once when it is over. Optional: the default
   * is src/speech/synth.ts. Listening is not paused meanwhile (the READ lane's pause, 29.5).
   */
  speak?(text: string, lang: string, onEnd: () => void): void
  // ---------- wake word and places (29.4) ----------
  /** Round 8 (29.4.1): the wake word while listenMode is wake; absent in the other modes. */
  wakeWord?: string
  // ---------- end of wake word and places ----------
  // ---------- reading aloud (29.5) ----------
  /** A reading aloud is in progress: a stop word (isReadStop) stops it first and does nothing else. Absent: never. */
  reading?(): boolean
  // ---------- the first run (30.1, ONBOARD lane) ----------
  /** The server's address is hosted (wss://, or a host other than this computer): the down line says so. */
  hosted?: boolean
  /** Round 9 (30.5.4): one record per task as it ends, never with words. Absent: nothing is kept. */
  spend?(record: SpendRecord): void
  /**
   * Round 10 (ARCHITECTURE 31.4): Kuula ainult mind is on. Nothing speech-driven runs without a
   * decision that verified the owner: partials are never typed or shown, and an utterance or a
   * continuation without one is dropped before the rules, the page, the model or the queue.
   */
  onlyOwner?: boolean
  // ---------- round 10: addressed speech (32) ----------
  /**
   * Round 10 (#6, 32.3): the addressee check of always-on mode (POST /api/addressee). A final no
   * rule knows is asked once: command, dictation, or not for Ütle. Absent, or in wake mode: no check.
   */
  addressee?(request: AddresseeRequest, signal: AbortSignal): Promise<AddresseeAnswer | AskFailure>
  /** Round 10 (#2, 32.2): the recogniser sends the audio off this computer (Soniox). With `hosted`, wake mode does not start. */
  uploads?: boolean
  // ---------- end of addressed speech ----------
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
  /**
   * Round 6 (26.1): his saved values, from the service worker. The rules and applyIntent find them
   * on the session; the model is told the names only.
   */
  setSaved(items: readonly SavedItem[]): void
  /**
   * Round 6 (26.5): the options page runs the voice entry flow. While on, every final utterance
   * goes to the page in front as savedEntry, never to the rules or the model.
   */
  setEntry(on: boolean): void
  // ---------- wake word and places (29.4) ----------
  /** Round 8 (29.4.2): his places (Minu kohad, merged over the defaults). The model is told the nouns only. */
  setPlaces(places: readonly Place[]): void
  // ---------- end of wake word and places ----------
}

/** How hard the model is asked to think (round 5). */
export type Care = NonNullable<IntentRequest['care']>

/** One utterance being spoken: its base (the box before it began) and the preview in the box. */
export interface Live {
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
  /** Round 8 (29.2): it began more than DOCUMENT_PAUSE_MS after the previous final (a document closes the open sentence first). */
  paused?: boolean
}

/**
 * Round 3: one utterance's model work. A later utterance interrupts it (no further step after
 * the page command in hand) and, unless the later one is a plain send waiting for a
 * verification, cancels it (the question in flight is given up).
 */
export interface Job {
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
  /** Round 8 (29.2): it came more than DOCUMENT_PAUSE_MS after the previous final; in a document the open sentence is closed first. */
  paused?: boolean
  /** Round 9 (30.5.4): what the model work cost, summed in askOnce. */
  spend: { asks: number; input: number; output: number; cacheRead: number; ms: number; provider: string; model: string; steps: number; goals: number }
  /** Round 9: how the model work ended, when it got that far; null otherwise. */
  ending: 'done' | 'stopped' | 'unclear' | null
  /** Round 9: the watchdog gave it up. */
  timedOut: boolean
  /** Round 9: a type-first job whose utterance a verification took over; the verification's job reports. */
  handedOff: boolean
  /** Round 10 (#5, 34.2): what each step ran (meant.ts ranOf), and whether the last one worked. */
  ran: string[]
  ok: boolean
  /** Round 10: the tab in front before it opened, switched or closed a tab: `2 "title"`. */
  from?: string
}

/** The model's answer, validated against the page it saw. */
export interface Heard {
  intent: ModelIntent
  say: string
  /** The model says the utterance asks for more after this step. */
  more: boolean
  /** Round 4: the goals after the one this step serves, in his words. Empty for one goal. */
  plan: string[]
  page: PageContext
}

/** How one step went, for the strip and for the model's next look. */
export interface Outcome {
  ok: boolean
  /** The strip's line about it. */
  line: string
}

/** How one goal's loop ended: done (the chain may go on), or stopped for good. */
export type GoalEnd = 'done' | 'stopped'

/** The state the engine's parts share, owned by createEngine. */
export interface EngineState {
  session: InpageSession
  /** Round 10 (#5, 34.2): his last commands, what ran and whether it worked, oldest first (at most RECENT_COMMANDS). */
  recent: RecentCommand[]
  /** Round 11 (F6): the last step that ran typed into a one-line field and the strip read it back; the addressee check is told. */
  readBack: boolean
  /** The server has said it has no model. A standing state: published on change only. */
  modelOff: boolean
  /**
   * Round 4: the goals the last utterance finished, in his words, so a continued utterance
   * ("siis ava Karin") can carry them as `completed`.
   */
  lastDone: string[]
  /** Round 8 (29.4.2): his places, merged over the defaults by the offscreen document (setPlaces); none until then. */
  places: Place[]
}

/** What the engine's parts (work, goals, wake) call back into createEngine for; each takes what it uses (Pick). */
export interface EngineParts {
  deps: EngineDeps
  st: EngineState
  inpageText: Strings['inpage']
  wakeText: Strings['wake']
  say(line: string): void
  runSafe(command: BrowserCommand): Promise<BrowserResult>
  readBox(): Promise<BoxState>
  takeBack(u: Live): Promise<void>
  setModelOff(off: boolean): void
  speakAloud(text: string): void
  scrollRan(command: BrowserCommand | undefined, result: BrowserResult, line: string): void
  placeStep(noun: string): InpageStep
  work: Work
  /** A job began or ended (the wake word's ACTIVE does not end mid-command). */
  onWorkChange(): void
  jobCount(): number
  entry(): boolean
  enrolling(): boolean
  whileReading(utterance: string): boolean
  dropLive(): void
  isPlainSend(utterance: string): boolean
}
