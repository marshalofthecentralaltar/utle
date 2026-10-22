// The offscreen document (docs/ARCHITECTURE.md 21.2): owns the microphone, the recogniser client
// and the in-page engine. It can only use chrome.runtime, so everything else goes through the
// service worker.

import type { BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import { IntentAnswerSchema } from '../../src/core/pageIntent.ts'
import type { IntentAnswer, IntentRequest, TabSummary } from '../../src/core/pageIntent.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { browserSocket, createLocalRecognizer, retrainDue } from '../../src/speech/local.ts'
import type { AudioSource } from '../../src/speech/local.ts'
import type { Recognizer } from '../../src/speech/recognizer.ts'
import { createMicrophoneFrames } from '../../src/speech/microphone.ts'
import { askTimeoutMs, createEngine } from './engine.ts'
import type { AskFailure, InpageLogic } from './engine.ts'
import type { RunAnswer, SavedAnswer, StripState, TabsAnswer, ToBackground, ToOffscreen } from './messages.ts'
import { savedFrom } from '../../src/core/saved.ts'
import { DEFAULT_ASR_URL, authHeaders, serverStatus, serverUrl, socketAddress } from './connection.ts'
// ---------- reading aloud (29.5) ----------
import type { Lang } from '../../src/core/strings.ts'
import { browserSpeech, createReader } from './reader.ts'
import type { SpeechPort } from './reader.ts'
import type { ReadBarAnswer } from './messages.ts'

// The server's address and status live in connection.ts (27.3), shared with the settings page.
export { DEFAULT_ASR_URL, STATUS_TIMEOUT_MS, serverStatus, serverUrl } from './connection.ts'

/**
 * How long a final is held to join the next one in this mode (21.3). Each final can be appended
 * to the box on its own, so it need not wait LOCAL_HOLD_MS (700 ms) for a following one.
 */
export const INPAGE_HOLD_MS = 150

export interface OffscreenOptions {
  /** The test's baseline build passes LOCAL_HOLD_MS to measure the old delay. Default INPAGE_HOLD_MS. */
  holdMs?: number
}

function tell(message: ToBackground): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined)
}

function errorMessage(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('error' in body)) return ''
  const error = body.error
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return ''
}

/**
 * POST /api/intent (M7). no_model: the server has no key; unreachable: no answer; bad: an answer of
 * the wrong shape. signal (round 3): the engine no longer wants the answer; the fetch ends with it.
 * token (27.3): the server token as a bearer header; a 401 is no_model, so the engine stops asking.
 */
export async function askIntent(intentUrl: string, request: IntentRequest, signal?: AbortSignal, token = ''): Promise<IntentAnswer | AskFailure> {
  const controller = new AbortController()
  // The engine gives up at ASK_TIMEOUT_MS (14 s for a careful ask, round 5); the request itself ends a little later, so no fetch dangles.
  const timer = setTimeout(() => controller.abort(), askTimeoutMs(request.care) + 1000)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)
  if (signal?.aborted) controller.abort()
  let body: unknown = null
  let response: Response
  try {
    response = await fetch(intentUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders(token) }, body: JSON.stringify(request), signal: controller.signal })
    try {
      body = await response.json()
    } catch {
      body = null
    }
  } catch {
    return { error: 'unreachable' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
  if (!response.ok) return response.status === 503 || response.status === 401 || errorMessage(body) === 'no_key' ? { error: 'no_model' } : { error: 'bad' }
  const parsed = IntentAnswerSchema.safeParse(body)
  return parsed.success ? parsed.data : { error: 'bad' }
}

/**
 * After a flush, the microphone stays open this long so the final can arrive (round 3). The server
 * first decodes what it still holds (up to its 1500 ms backlog), and Soniox answers a finalize over
 * the network; when the final is later than this, the recogniser delivers the words as last heard.
 */
export const FLUSH_STOP_MS = 800

/** Round 4: the "someone else spoke" line stays on the strip this long. */
export const FOREIGN_SHOWN_MS = 3000

/** Round 7: a scripted profile from fewer phrases than this is kept, and the bar says it is thin (server/speaker.ts ENOUGH_PHRASES). */
export const ENOUGH_PHRASES = 6
/**
 * Round 7: scripted enrolment goes through the engine's enrolment (it starts listening and ignores
 * what he reads) with this many seconds; the engine gives up after five times it, 5 minutes.
 */
export const SCRIPT_ENROL_SECONDS = 60

/**
 * Round 7: what the strip shows for a dropped final: the foreign line every time, and, at the third
 * in a row, once, the line that tells him to teach his voice again.
 */
export function foreignNotice(streak: number, text: { foreign: string; foreignRetrain: string }): { foreign: string; line?: string } {
  return retrainDue(streak) ? { foreign: text.foreign, line: text.foreignRetrain } : { foreign: text.foreign }
}

/** Round 7: the strip's line when enrolment ends: phrases is set after scripted enrolment. */
export function enrolledLine(ok: boolean, phrases: number | undefined, text: { enrolDone: string; enrolFailed: string; enrolPhrasesDone(n: number): string; enrolFew(n: number, enough: number): string }): string {
  if (!ok) return text.enrolFailed
  if (phrases === undefined) return text.enrolDone
  return phrases < ENOUGH_PHRASES ? text.enrolFew(phrases, ENOUGH_PHRASES) : text.enrolPhrasesDone(phrases)
}

/** The speech model's address with the engine chosen on the options page: ?engine=soniox asks the dev server for Soniox (round 3). */
export function asrAddress(base: string, engine: string | null): string {
  if (engine !== 'soniox') return base
  const url = new URL(base)
  url.searchParams.set('engine', 'soniox')
  return url.toString()
}

// ---------- reading aloud (29.5) ----------

export type ReadCommand = Extract<BrowserCommand, { kind: 'read' }>

/** "Loe riba ette": a line this long or longer is not spoken, nor the same line again within BAR_REPEAT_MS. */
export const BAR_LINE_MAX = 200
export const BAR_REPEAT_MS = 1500

/**
 * The pause rule (29.5): while muted() the recogniser gets silence of the same length instead of the
 * microphone's samples. The track and the socket stay open; the server ends an utterance in progress
 * on the silence and never hears the synthesised voice.
 */
export function mutedSource(inner: AudioSource, muted: () => boolean): AudioSource {
  return {
    start: (onFrame) => inner.start((samples) => onFrame(muted() ? new Float32Array(samples.length) : samples)),
    stop: () => inner.stop(),
  }
}

export interface ReadAloudDeps {
  lang: Lang
  port(): SpeechPort | null
  /** Runs read page, box or selection on the page in front; the answer carries `reading`. */
  fetch(command: ReadCommand): Promise<BrowserResult>
  publish(patch: Partial<StripState>): void
  now?(): number
}

export interface ReadAloud {
  /** One read command. fetched: the page's answer when the caller already has it (the harness's bridge). */
  run(command: ReadCommand, fetched?: BrowserResult): Promise<BrowserResult>
  /** Stops a reading in progress; false when there was none. */
  stop(): boolean
  readonly reading: boolean
  /** The microphone is handed silence (mutedSource). */
  readonly muted: boolean
  setReadBar(on: boolean): void
  /** The strip's publish, through which "Loe riba ette" hears every new amber line. */
  publish(patch: Partial<StripState>): void
}

export function createReadAloud(deps: ReadAloudDeps): ReadAloud {
  const text = STRINGS[deps.lang].read
  const now = deps.now ?? (() => Date.now())
  let muted = false
  let readBar = false
  let lastLine = ''
  let lastAt = Number.NEGATIVE_INFINITY

  const publish = (patch: Partial<StripState>): void => {
    deps.publish(patch)
    const line = patch.line
    if (!readBar || typeof line !== 'string' || line.trim() === '' || line.length >= BAR_LINE_MAX || reader.reading) return
    const at = now()
    if (line === lastLine && at - lastAt < BAR_REPEAT_MS) return
    lastLine = line
    lastAt = at
    reader.sayLine(line)
  }

  const reader = createReader({
    port: deps.port,
    onAloud: (on) => {
      muted = on
      deps.publish({ micMuted: on })
    },
    onReading: (on) => publish(on ? { reading: true, line: text.now } : { reading: false }),
    onLine: (line) => publish({ line: line === 'skipped' ? text.skipped : text.ended }),
  })

  const failed = (code: 'not_found' | 'not_allowed', message: string, line: string): BrowserResult => {
    publish({ line })
    return { ok: false, code, message }
  }

  return {
    async run(command, fetched) {
      switch (command.what) {
        case 'stop':
          if (reader.stop()) publish({ line: text.stopped })
          return { ok: true }
        case 'continue':
          return reader.next() ? { ok: true } : failed('not_found', 'Nothing more to read.', text.ended)
        default: {
          const answer = fetched ?? (await deps.fetch(command))
          if (!answer.ok) return answer
          const reading = answer.reading ?? { text: '', sentences: [] }
          const outcome = await reader.read(reading.sentences)
          if (outcome === 'nothing') return failed('not_found', 'Nothing to read here.', text.nothing)
          if (outcome === 'no_voice') return failed('not_allowed', 'This browser has no Estonian voice.', text.noVoice)
          return { ok: true, reading }
        }
      }
    },
    stop: () => {
      const was = reader.stop()
      if (was) publish({ line: text.stopped })
      return was
    },
    get reading() {
      return reader.reading
    },
    get muted() {
      return muted
    },
    setReadBar(on) {
      readBar = on
    },
    publish,
  }
}
// ---------- end of reading aloud ----------

export function startOffscreen(logic: InpageLogic, options: OffscreenOptions = {}): void {
  const params = new URLSearchParams(location.search)
  // The token (27.3) comes in the document's address: an offscreen document cannot read chrome.storage.
  const token = params.get('token') ?? ''
  const address = socketAddress(asrAddress(params.get('asr') ?? DEFAULT_ASR_URL, params.get('engine')), token)
  const intentUrl = serverUrl(address, '/api/intent')
  const statusUrl = serverUrl(address, '/api/status')
  let connects = 0
  let micOpens = 0
  const publish = (patch: Partial<StripState>): void => {
    void tell({ type: 'utle-state', patch })
  }

  const microphone = (): AudioSource => {
    const inner = createMicrophoneFrames(chrome.runtime.getURL('dist/asr-worklet.js'))
    return {
      async start(onFrame) {
        await inner.start(onFrame)
        micOpens += 1
        publish({ micOpens, micOpenedAt: Date.now() })
      },
      stop: () => inner.stop(),
    }
  }

  // ---------- reading aloud (29.5): the reader, the pause rule, "Loe riba ette" ----------
  const toPage = async (command: BrowserCommand): Promise<BrowserResult> => {
    const answer = (await tell({ type: 'utle-run', command })) as RunAnswer | undefined
    return answer?.result ?? { ok: false, code: 'failed', message: 'The extension did not answer.' }
  }
  const readAloud = createReadAloud({ lang: 'et', port: browserSpeech, fetch: toPage, publish })
  void tell({ type: 'utle-read-bar' }).then((answer) => readAloud.setReadBar((answer as ReadBarAnswer | undefined)?.on === true))
  chrome.runtime.onMessage.addListener((message: ToOffscreen, _sender, sendResponse: (answer: RunAnswer) => void) => {
    if (!message || message.target !== 'offscreen') return false
    if (message.type === 'readBar') readAloud.setReadBar(message.on)
    if (message.type !== 'read') return false
    readAloud.run(message.command, message.fetched).then(
      (result) => sendResponse({ result }),
      () => sendResponse({ result: { ok: false, code: 'failed', message: 'Reading aloud failed.' } }),
    )
    return true
  })
  // ---------- end of reading aloud ----------

  const run = async (command: BrowserCommand): Promise<BrowserResult> => {
    if (command.kind === 'read') return readAloud.run(command)
    const answer = (await tell({ type: 'utle-run', command })) as RunAnswer | undefined
    return answer?.result ?? { ok: false, code: 'failed', message: 'The extension did not answer.' }
  }

  // The owner's voice (round 4, VOICE lane): the foreign line and the enrolment lines go straight
  // to the strip; the engine's own handlers run first (review: it takes back the foreign preview
  // and ignores what he says while the server learns his voice).
  const stripText = STRINGS.et.strip
  const onlyOwner = params.get('onlyOwner') === '1'
  let foreignTimer: ReturnType<typeof setTimeout> | null = null
  const onForeign = (streak: number): void => {
    publish(foreignNotice(streak, stripText))
    if (foreignTimer !== null) clearTimeout(foreignTimer)
    foreignTimer = setTimeout(() => {
      foreignTimer = null
      publish({ foreign: '' })
    }, FOREIGN_SHOWN_MS)
  }
  const onEnrolled = (ok: boolean, phrases: number | undefined): void => {
    publish({ line: enrolledLine(ok, phrases, stripText), enrolPhrases: -1 })
  }
  /**
   * Round 7: scripted enrolment rides on the engine's enrolment (listening starts, what he reads is
   * neither typed nor run, onEnrolled ends it). While `scripted` is set, the engine's call to the
   * recogniser's enrol becomes enrolScript.
   */
  let scripted: number | null = null
  let recognizer: Recognizer | null = null

  const engine = createEngine({
    logic,
    lang: 'et',
    run,
    publish: readAloud.publish,
    reading: () => readAloud.reading,
    // The handlers go through whole, onLag (round 3) with them: the recogniser reports its lag to the engine, the engine to the strip.
    recognizer: (handlers, isInstant, onUnavailable) => {
      const inner = createLocalRecognizer(
        {
          ...handlers,
          onForeign: (streak) => {
            handlers.onForeign()
            onForeign(streak)
          },
          onEnrolled: (ok, seconds, phrases) => {
            handlers.onEnrolled(ok, seconds)
            onEnrolled(ok, phrases)
          },
          onEnrolPhrase: (count) => publish({ enrolPhrases: count }),
        },
        isInstant,
        {
          onUnavailable,
          address,
          holdMs: options.holdMs ?? INPAGE_HOLD_MS,
          onlyOwner,
          connect: (events) => {
            connects += 1
            publish({ connects })
            return browserSocket(events, address)
          },
          audio: () => mutedSource(microphone(), () => readAloud.muted),
        },
      )
      const wrapped: Recognizer = {
        ...inner,
        supported: inner.supported,
        start: () => inner.start(),
        stop: () => inner.stop(),
        setLang: (lang) => inner.setLang(lang),
        flush: () => inner.flush?.(),
        enrol: (seconds) => {
          const phrases = scripted
          scripted = null
          if (phrases !== null) inner.enrolScript?.(phrases)
          else inner.enrol?.(seconds)
        },
      }
      recognizer = inner
      return wrapped
    },
    micBlocked: () => {
      void tell({ type: 'utle-mic-blocked' })
    },
    ask: (request, signal) => askIntent(intentUrl, request, signal, token),
    tabs: async (): Promise<TabSummary[]> => {
      const answer = (await tell({ type: 'utle-tabs' })) as TabsAnswer | undefined
      return answer?.tabs ?? []
    },
    status: () => serverStatus(statusUrl, token),
  })

  // Round 6 (26.1, 26.5): his saved values and whether the entry flow runs, once at start; changes arrive as messages.
  void tell({ type: 'utle-saved' }).then((answer) => {
    const saved = answer as SavedAnswer | undefined
    engine.setSaved(savedFrom(saved?.items))
    engine.setEntry(saved?.entry === true)
  })

  // Gaze mode (round 3): a stop with flush delivers the words said so far, then stops once the final has had time to arrive.
  let pendingStop: ReturnType<typeof setTimeout> | null = null
  const cancelStop = (): void => {
    if (pendingStop === null) return
    clearTimeout(pendingStop)
    pendingStop = null
  }
  chrome.runtime.onMessage.addListener((message: ToOffscreen) => {
    if (!message || message.target !== 'offscreen') return false
    switch (message.type) {
      case 'toggle':
        cancelStop()
        // 29.5: the microphone pressed while reading stops the reading; listening stays as it was.
        if (readAloud.stop()) break
        engine.toggle()
        break
      case 'start':
        cancelStop()
        engine.start()
        break
      case 'flush':
        engine.flush()
        break
      case 'saved':
        engine.setSaved(savedFrom(message.items))
        break
      case 'entry':
        engine.setEntry(message.on)
        break
      case 'enrol':
        // Round 4: listening starts when it was off; the line tells him to speak, the server answers through onEnrolled.
        cancelStop()
        engine.enrol(message.seconds)
        publish({ line: stripText.enrolStart(message.seconds) })
        break
      case 'enrolScript':
        // Round 7: the settings page shows the phrases; the strip says to read them.
        cancelStop()
        scripted = message.phrases
        engine.enrol(SCRIPT_ENROL_SECONDS)
        scripted = null
        publish({ line: stripText.scriptStart, enrolPhrases: 0 })
        break
      case 'enrolFinish':
        recognizer?.enrolFinish?.()
        break
      case 'stop':
        cancelStop()
        if (message.flush === true && engine.listening) {
          engine.flush()
          pendingStop = setTimeout(() => {
            pendingStop = null
            engine.stop()
          }, FLUSH_STOP_MS)
        } else engine.stop()
        break
      default:
        break
    }
    return false
  })
}
