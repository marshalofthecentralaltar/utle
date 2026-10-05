/**
 * A second recogniser behind the same wire (ARCHITECTURE 20.1 and 23.4): Soniox's real-time
 * speech-to-text, reached from the dev server. The browser speaks the Ütle protocol
 * (src/speech/asrProtocol.ts) and never sees Soniox; the key stays on the server.
 *
 * SONIOX API FACTS THIS FILE RELIES ON, as read on 2026-10-05. Soniox's own documentation site
 * (https://soniox.com/docs/api-reference/stt/websocket-api, https://soniox.com/docs/stt/rt/endpoint-detection,
 * https://soniox.com/docs/stt/rt/connection-keepalive) was not reachable from the machine that wrote this,
 * so each fact below was taken from Soniox's own client source and two integrations that use the API
 * directly, and from search snippets of those documentation pages:
 *   - https://github.com/soniox/speech-to-text-web (src/soniox-client.ts): URL, config field names, binary
 *     audio, finalize and keepalive messages, error fields, `finished`, end of stream.
 *   - https://github.com/agentvoiceresponse/avr-asr-soniox (index.js): config values, `tokens[].is_final`.
 *   - Search snippets of the documentation pages named above: `<end>`, keepalive interval, error codes.
 * If Soniox differs, every name is in the constants right below this comment.
 *
 *   URL          wss://stt-rt.soniox.com/transcribe-websocket
 *   First frame  a text frame of JSON: { api_key, model, audio_format: 'pcm_s16le', sample_rate: 16000,
 *                num_channels: 1, language_hints: ['et'], enable_endpoint_detection: true }
 *                (`enable_language_identification`, `context`, `max_endpoint_delay_ms` exist and are not used).
 *   Audio        binary frames of raw PCM in the declared format, as many bytes per frame as one likes.
 *   Responses    text frames of JSON: { tokens: [{ text, start_ms, end_ms, confidence, is_final, language?, speaker? }],
 *                final_audio_proc_ms, total_audio_proc_ms, finished?: boolean, error_code?: number, error_message?: string }.
 *                Final tokens are sent once and never again; non-final tokens are sent whole in every
 *                response and replace the previous non-final tokens. Token text carries its own leading space.
 *   Endpoint     with endpoint detection on, a token whose text is `<end>` (is_final true) closes the utterance.
 *   Finalize     the client sends the text frame {"type":"finalize"}; the server finalises what it holds. The
 *                documentation names a `<fin>` token that marks the end of a manual finalisation; this file
 *                treats `<fin>` as that marker and also accepts the plain arrival of the finals.
 *   Keepalive    the text frame {"type":"keepalive"} at least every 20 s while no audio is sent.
 *   End          the client sends an empty text frame; the server answers its last tokens with finished: true.
 *   Errors       a response with error_code (an HTTP status, 401 for a bad key, 503 when overloaded) and
 *                error_message, after which the server closes.
 *   Model        'stt-rt-v5' is the current real-time model name seen in Soniox's material in 2026; Estonian
 *                is among its 60+ languages. SONIOX_MODEL overrides it.
 */
import { WebSocket } from 'ws'
import type { RawData } from 'ws'
import type { AsrServerMessage } from '../src/speech/asrProtocol.ts'
import { samplesFromFrame } from './asrSession.ts'

export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
export const SONIOX_DEFAULT_MODEL = 'stt-rt-v5'
export const SONIOX_KEY_VAR = 'SONIOX_API_KEY'
export const SONIOX_END_TOKEN = '<end>'
export const SONIOX_FIN_TOKEN = '<fin>'
export const SONIOX_FINALIZE = '{"type":"finalize"}'
export const SONIOX_KEEPALIVE = '{"type":"keepalive"}'
/** Soniox wants a keepalive within 20 s of silence; 10 s leaves room for a slow network. */
export const SONIOX_KEEPALIVE_MS = 10_000

/** The first frame to Soniox. Exported so the test and the owner can see every field in one place. */
export function sonioxConfig(apiKey: string, model: string): Record<string, unknown> {
  return {
    api_key: apiKey,
    model,
    audio_format: 'pcm_s16le',
    sample_rate: 16000,
    num_channels: 1,
    language_hints: ['et'],
    enable_endpoint_detection: true,
  }
}

/** The parts of a `ws` WebSocket this file uses, on both sides: the browser's socket and Soniox's. */
export interface SocketLike {
  readonly readyState: number
  send(data: string | Uint8Array): void
  close(code?: number): void
  on(event: 'open', listener: () => void): unknown
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number) => void): unknown
}

const OPEN = 1

export interface SonioxOptions {
  /** The Soniox key. Unset or empty: the session is unavailable at once. */
  apiKey: string | undefined
  /** Opens the socket to Soniox. The test passes a fake; the default is `ws`. */
  connect?: (url: string) => SocketLike
  model?: string
  /** Keepalive period in ms; 0 sends none (the test). */
  keepaliveMs?: number
}

/** Float32 samples in [-1, 1] to 16-bit little-endian PCM, as Soniox wants it. */
export function int16FromFloat32(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    out.writeInt16LE(Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767), i * 2)
  }
  return out
}

type SonioxToken = { text: string; is_final: boolean }
type SonioxResponse = { tokens: SonioxToken[]; finished: boolean; errorCode: number | null }

/** Reads one Soniox response; null when the frame is not one. */
export function parseSonioxResponse(raw: string): SonioxResponse | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const hasError = record.error_code !== undefined || record.error_message !== undefined
  const errorCode = hasError ? (typeof record.error_code === 'number' ? record.error_code : 0) : null
  const tokens: SonioxToken[] = []
  if (Array.isArray(record.tokens)) {
    for (const item of record.tokens) {
      if (typeof item !== 'object' || item === null) continue
      const token = item as Record<string, unknown>
      if (typeof token.text === 'string') tokens.push({ text: token.text, is_final: token.is_final === true })
    }
  }
  return { tokens, finished: record.finished === true, errorCode }
}

/**
 * Maps Soniox tokens onto Ütle utterances: finals accumulate, non-finals replace, `<end>` or `<fin>`
 * closes the utterance. Pure, so the test can script it.
 */
export function createUtteranceMapper(send: (message: AsrServerMessage) => void): { tokens(tokens: SonioxToken[]): void; flushed(): void } {
  let final = ''
  let nonFinal = ''
  let lastPartial = ''

  const emitFinal = (): void => {
    const text = (final + nonFinal).trim()
    if (text !== '') send({ type: 'final', text })
    final = ''
    nonFinal = ''
    lastPartial = ''
  }

  return {
    tokens(tokens) {
      let pending = ''
      for (const token of tokens) {
        if (token.text === SONIOX_END_TOKEN || token.text === SONIOX_FIN_TOKEN) {
          nonFinal = ''
          emitFinal()
          continue
        }
        if (token.is_final) final += token.text
        else pending += token.text
      }
      nonFinal = pending
      const partial = (final + nonFinal).trim()
      if (partial !== '' && partial !== lastPartial) send({ type: 'partial', text: partial })
      lastPartial = partial
    },
    flushed() {
      emitFinal()
    },
  }
}

/**
 * Takes over one browser socket at /api/asr and serves it from Soniox. Logs connection events and
 * error codes only: never audio, never text.
 */
export function attachSonioxSession(ws: SocketLike, options: SonioxOptions): void {
  const send = (message: AsrServerMessage): void => {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(message))
  }
  const apiKey = options.apiKey ?? ''
  if (apiKey === '') {
    console.warn(`[soniox] ${SONIOX_KEY_VAR} is not set; the Soniox engine is unavailable`)
    send({ type: 'unavailable', reason: 'load_failed' })
    ws.close(1011)
    return
  }

  const connect = options.connect ?? ((url: string): SocketLike => new WebSocket(url))
  const model = options.model ?? process.env.SONIOX_MODEL ?? SONIOX_DEFAULT_MODEL
  const keepaliveMs = options.keepaliveMs ?? SONIOX_KEEPALIVE_MS
  const mapper = createUtteranceMapper(send)
  const buffered: Buffer[] = []
  let upstreamReady = false
  let browserClosed = false
  let failed = false
  let keepalive: ReturnType<typeof setInterval> | null = null

  const upstream = connect(SONIOX_URL)
  console.info('[soniox] connecting')

  const stopKeepalive = (): void => {
    if (keepalive) clearInterval(keepalive)
    keepalive = null
  }

  const fail = (what: string): void => {
    if (failed || browserClosed) return
    failed = true
    console.warn(`[soniox] ${what}`)
    stopKeepalive()
    send({ type: 'unavailable', reason: 'load_failed' })
    ws.close(1011)
    try {
      upstream.close()
    } catch {
      // Already gone.
    }
  }

  upstream.on('open', () => {
    if (browserClosed) {
      upstream.close()
      return
    }
    upstream.send(JSON.stringify(sonioxConfig(apiKey, model)))
    upstreamReady = true
    for (const frame of buffered) upstream.send(frame)
    buffered.length = 0
    if (keepaliveMs > 0) {
      keepalive = setInterval(() => {
        if (upstream.readyState === OPEN) upstream.send(SONIOX_KEEPALIVE)
      }, keepaliveMs)
    }
    send({ type: 'ready' })
    console.info('[soniox] session open')
  })

  upstream.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) return
    const response = parseSonioxResponse(rawToString(data))
    if (!response) return
    if (response.errorCode !== null) {
      fail(`error ${response.errorCode}`)
      return
    }
    mapper.tokens(response.tokens)
    if (response.finished) {
      mapper.flushed()
      stopKeepalive()
      upstream.close()
    }
  })

  upstream.on('error', () => fail('socket error'))
  upstream.on('close', (code: number) => {
    stopKeepalive()
    if (!browserClosed && !failed) fail(`closed by Soniox, code ${code}`)
  })

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (failed) return
    if (isBinary) {
      if (!Buffer.isBuffer(data)) return
      const samples = samplesFromFrame(data)
      if (!samples) return
      const pcm = int16FromFloat32(samples)
      if (upstreamReady && upstream.readyState === OPEN) upstream.send(pcm)
      else buffered.push(pcm)
      return
    }
    if (rawToString(data).includes('"flush"') && upstreamReady && upstream.readyState === OPEN) upstream.send(SONIOX_FINALIZE)
  })

  ws.on('close', (code: number) => {
    browserClosed = true
    stopKeepalive()
    console.info(`[soniox] browser closed, code ${code}`)
    if (upstream.readyState === OPEN) {
      upstream.send('')
      upstream.close()
    }
  })
}

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  return Buffer.from(new Uint8Array(data)).toString('utf8')
}
