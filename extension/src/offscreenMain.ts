// The offscreen document (docs/ARCHITECTURE.md 21.2): owns the microphone, the recogniser client
// and the in-page engine. It can only use chrome.runtime, so everything else goes through the
// service worker.

import type { BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import { IntentAnswerSchema } from '../../src/core/pageIntent.ts'
import type { IntentAnswer, IntentRequest, TabSummary } from '../../src/core/pageIntent.ts'
import { browserSocket, createLocalRecognizer } from '../../src/speech/local.ts'
import type { AudioSource } from '../../src/speech/local.ts'
import { createMicrophoneFrames } from '../../src/speech/microphone.ts'
import { ASK_TIMEOUT_MS, createEngine } from './engine.ts'
import type { AskFailure, InpageLogic } from './engine.ts'
import type { RunAnswer, StripState, TabsAnswer, ToBackground, ToOffscreen } from './messages.ts'

export const DEFAULT_ASR_URL = 'ws://localhost:5173/api/asr'

/**
 * How long a final is held to join the next one in this mode (21.3). Each final can be appended
 * to the box on its own, so it need not wait LOCAL_HOLD_MS (700 ms) for a following one.
 */
export const INPAGE_HOLD_MS = 150

/** GET /api/status may take this long before the engine goes on without it. */
export const STATUS_TIMEOUT_MS = 3000

export interface OffscreenOptions {
  /** The test's baseline build passes LOCAL_HOLD_MS to measure the old delay. Default INPAGE_HOLD_MS. */
  holdMs?: number
}

function tell(message: ToBackground): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined)
}

/** The dev server's http address for path, from the speech model's address (ws(s)://host/api/asr → http(s)://host/path). */
export function serverUrl(asrAddress: string, path: string): string {
  const url = new URL(asrAddress)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = path
  url.search = ''
  return url.toString()
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
 */
export async function askIntent(intentUrl: string, request: IntentRequest, signal?: AbortSignal): Promise<IntentAnswer | AskFailure> {
  const controller = new AbortController()
  // The engine gives up at ASK_TIMEOUT_MS; the request itself ends a little later, so no fetch dangles.
  const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS + 1000)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)
  if (signal?.aborted) controller.abort()
  let body: unknown = null
  let response: Response
  try {
    response = await fetch(intentUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal })
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
  if (!response.ok) return response.status === 503 || errorMessage(body) === 'no_key' ? { error: 'no_model' } : { error: 'bad' }
  const parsed = IntentAnswerSchema.safeParse(body)
  return parsed.success ? parsed.data : { error: 'bad' }
}

/** GET /api/status (M7): whether the server has a model. */
export async function serverStatus(statusUrl: string): Promise<'live' | 'no_key' | 'unreachable'> {
  try {
    // Checked once in the engine's queue before the first utterance: a server that hangs must not hold it.
    const response = await fetch(statusUrl, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) })
    if (!response.ok) return 'unreachable'
    const body: unknown = await response.json()
    const intent = typeof body === 'object' && body !== null && 'intent' in body ? body.intent : undefined
    return intent === 'no_key' ? 'no_key' : 'live'
  } catch {
    return 'unreachable'
  }
}

export function startOffscreen(logic: InpageLogic, options: OffscreenOptions = {}): void {
  const address = new URLSearchParams(location.search).get('asr') ?? DEFAULT_ASR_URL
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

  const run = async (command: BrowserCommand): Promise<BrowserResult> => {
    const answer = (await tell({ type: 'utle-run', command })) as RunAnswer | undefined
    return answer?.result ?? { ok: false, code: 'failed', message: 'The extension did not answer.' }
  }

  const engine = createEngine({
    logic,
    lang: 'et',
    run,
    publish,
    // The handlers go through whole, onLag (round 3) with them: the recogniser reports its lag to the engine, the engine to the strip.
    recognizer: (handlers, isInstant, onUnavailable) =>
      createLocalRecognizer(handlers, isInstant, {
        onUnavailable,
        address,
        holdMs: options.holdMs ?? INPAGE_HOLD_MS,
        connect: (events) => {
          connects += 1
          publish({ connects })
          return browserSocket(events, address)
        },
        audio: microphone,
      }),
    micBlocked: () => {
      void tell({ type: 'utle-mic-blocked' })
    },
    ask: (request, signal) => askIntent(intentUrl, request, signal),
    tabs: async (): Promise<TabSummary[]> => {
      const answer = (await tell({ type: 'utle-tabs' })) as TabsAnswer | undefined
      return answer?.tabs ?? []
    },
    status: () => serverStatus(statusUrl),
  })

  chrome.runtime.onMessage.addListener((message: ToOffscreen) => {
    if (!message || message.target !== 'offscreen') return false
    if (message.type === 'toggle') engine.toggle()
    else if (message.type === 'start') engine.start()
    return false
  })
}
