import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RawData } from 'ws'
import type { AsrServerMessage } from '../src/speech/asrProtocol.ts'
import {
  SONIOX_FINALIZE,
  SONIOX_KEEPALIVE,
  SONIOX_URL,
  attachSonioxSession,
  createUtteranceMapper,
  int16FromFloat32,
  parseSonioxResponse,
  sonioxConfig,
} from './soniox.ts'
import type { SocketLike } from './soniox.ts'

type Listener = (...args: never[]) => void

/** A ws-shaped socket that records what was sent and lets the test fire events. */
class FakeSocket implements SocketLike {
  readyState = 0
  sent: (string | Uint8Array)[] = []
  closedWith: number | undefined
  closed = false
  private listeners = new Map<string, Listener[]>()

  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }
  close(code?: number): void {
    this.closed = true
    this.closedWith = code
    this.readyState = 3
  }
  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args)
  }
  open(): void {
    this.readyState = 1
    this.emit('open')
  }
  text(raw: string): void {
    this.emit('message', Buffer.from(raw) as RawData, false)
  }
  binary(buffer: Buffer): void {
    this.emit('message', buffer as RawData, true)
  }
  /** The text frames sent, parsed. */
  get json(): unknown[] {
    return this.sent.filter((item): item is string => typeof item === 'string' && item !== '').map((item) => JSON.parse(item) as unknown)
  }
}

const floatFrame = (...values: number[]): Buffer => Buffer.from(new Float32Array(values).buffer)

function session(options: { apiKey?: string; keepaliveMs?: number } = {}): { browser: FakeSocket; upstream: FakeSocket; urls: string[] } {
  const browser = new FakeSocket()
  browser.readyState = 1
  const upstream = new FakeSocket()
  const urls: string[] = []
  attachSonioxSession(browser, {
    apiKey: 'apiKey' in options ? options.apiKey : 'test-key',
    connect: (url) => {
      urls.push(url)
      return upstream
    },
    keepaliveMs: options.keepaliveMs ?? 0,
  })
  return { browser, upstream, urls }
}

const response = (tokens: { text: string; is_final: boolean }[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ tokens, final_audio_proc_ms: 0, total_audio_proc_ms: 0, ...extra })

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('soniox config', () => {
  it('names every field Soniox needs for 16 kHz mono Estonian with endpoints', () => {
    expect(sonioxConfig('k', 'stt-rt-v5')).toEqual({
      api_key: 'k',
      model: 'stt-rt-v5',
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ['et'],
      enable_endpoint_detection: true,
    })
  })

  it('opens the documented address, sends the config as the first frame, then says ready', () => {
    const { browser, upstream, urls } = session()
    expect(urls).toEqual([SONIOX_URL])
    expect(browser.json).toEqual([])
    upstream.open()
    expect(upstream.json[0]).toEqual(sonioxConfig('test-key', 'stt-rt-v5'))
    expect(browser.json).toEqual([{ type: 'ready' }])
  })
})

describe('float32 to int16', () => {
  it('scales, clamps and writes little-endian', () => {
    const pcm = int16FromFloat32(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]))
    expect(pcm.byteLength).toBe(14)
    expect(pcm.readInt16LE(0)).toBe(0)
    expect(pcm.readInt16LE(2)).toBe(16384)
    expect(pcm.readInt16LE(4)).toBe(-16384)
    expect(pcm.readInt16LE(6)).toBe(32767)
    expect(pcm.readInt16LE(8)).toBe(-32768)
    expect(pcm.readInt16LE(10)).toBe(32767)
    expect(pcm.readInt16LE(12)).toBe(-32768)
    expect(pcm[2]).toBe(0x00)
    expect(pcm[3]).toBe(0x40)
  })

  it('buffers audio until Soniox is open, then forwards every frame converted', () => {
    const { browser, upstream } = session()
    browser.binary(floatFrame(0.5, -0.5))
    expect(upstream.sent).toEqual([])
    upstream.open()
    browser.binary(floatFrame(1))
    const binaries = upstream.sent.filter((item): item is Uint8Array => typeof item !== 'string')
    expect(binaries.map((b) => Array.from(b))).toEqual([
      [0x00, 0x40, 0x00, 0xc0],
      [0xff, 0x7f],
    ])
    // The config came before the first audio frame.
    expect(typeof upstream.sent[0]).toBe('string')
  })

  it('ignores frames that are not whole float32 samples', () => {
    const { browser, upstream } = session()
    upstream.open()
    browser.binary(Buffer.from([1, 2, 3]))
    expect(upstream.sent.filter((item) => typeof item !== 'string')).toEqual([])
  })
})

describe('token mapping', () => {
  it('sends a partial on every change and a final at <end> (no partial for words that end in the same response), then starts the next utterance', () => {
    const sent: AsrServerMessage[] = []
    const mapper = createUtteranceMapper((m) => sent.push(m))
    mapper.tokens([{ text: 'Ava', is_final: false }])
    mapper.tokens([{ text: 'Ava', is_final: false }, { text: ' uus', is_final: false }])
    mapper.tokens([{ text: 'Ava', is_final: true }, { text: ' uus', is_final: false }])
    mapper.tokens([{ text: ' uus', is_final: true }, { text: ' vaheleht', is_final: true }, { text: '<end>', is_final: true }])
    mapper.tokens([{ text: 'Saada', is_final: false }])
    expect(sent).toEqual([
      { type: 'partial', text: 'Ava' },
      { type: 'partial', text: 'Ava uus' },
      { type: 'final', text: 'Ava uus vaheleht' },
      { type: 'partial', text: 'Saada' },
    ])
  })

  it('handles two utterances in one response and sends nothing for an empty one', () => {
    const sent: AsrServerMessage[] = []
    const mapper = createUtteranceMapper((m) => sent.push(m))
    mapper.tokens([
      { text: 'Jah', is_final: true },
      { text: '<end>', is_final: true },
      { text: ' ei', is_final: true },
      { text: '<end>', is_final: true },
      { text: '<end>', is_final: true },
      { text: ' mitte', is_final: false },
    ])
    expect(sent).toEqual([
      { type: 'final', text: 'Jah' },
      { type: 'final', text: 'ei' },
      { type: 'partial', text: 'mitte' },
    ])
  })

  it('maps a scripted Soniox message sequence end to end', () => {
    const { browser, upstream } = session()
    upstream.open()
    upstream.text(response([{ text: 'Tere', is_final: false }]))
    upstream.text(response([{ text: 'Tere', is_final: true }, { text: ' Mari', is_final: false }]))
    upstream.text(response([{ text: ' Mari', is_final: true }, { text: '<end>', is_final: true }]))
    expect(browser.json).toEqual([
      { type: 'ready' },
      { type: 'partial', text: 'Tere' },
      { type: 'partial', text: 'Tere Mari' },
      { type: 'final', text: 'Tere Mari' },
    ])
    expect(browser.closed).toBe(false)
  })

  it('reads the documented response shape and ignores the rest', () => {
    expect(parseSonioxResponse('{"tokens":[{"text":"a","start_ms":0,"end_ms":10,"confidence":0.9,"is_final":true}],"final_audio_proc_ms":10,"total_audio_proc_ms":10}')).toEqual({
      tokens: [{ text: 'a', is_final: true }],
      finished: false,
      errorCode: null,
    })
    expect(parseSonioxResponse('{"tokens":[],"finished":true}')).toEqual({ tokens: [], finished: true, errorCode: null })
    expect(parseSonioxResponse('{"error_code":401,"error_message":"bad key"}')).toMatchObject({ errorCode: 401 })
    expect(parseSonioxResponse('not json')).toBeNull()
    expect(parseSonioxResponse('[]')).toBeNull()
  })
})

describe('flush', () => {
  it('sends finalize to Soniox and the final when Soniox answers with the finals', () => {
    const { browser, upstream } = session()
    upstream.open()
    upstream.text(response([{ text: 'Saada', is_final: false }]))
    browser.text('{"type":"flush"}')
    expect(upstream.sent.at(-1)).toBe(SONIOX_FINALIZE)
    upstream.text(response([{ text: 'Saada', is_final: true }, { text: '<fin>', is_final: true }]))
    expect(browser.json).toEqual([{ type: 'ready' }, { type: 'partial', text: 'Saada' }, { type: 'final', text: 'Saada' }])
  })

  it('sends no finalize before Soniox is open', () => {
    const { browser, upstream } = session()
    browser.text('{"type":"flush"}')
    expect(upstream.sent).toEqual([])
  })
})

describe('unavailable', () => {
  it('without a key: unavailable at once, closed 1011, a warning that names the variable, no connection', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { browser, urls } = session({ apiKey: undefined })
    expect(urls).toEqual([])
    expect(browser.json).toEqual([{ type: 'unavailable', reason: 'load_failed' }])
    expect(browser.closedWith).toBe(1011)
    expect(warn.mock.calls.flat().join(' ')).toContain('SONIOX_API_KEY')
  })

  it('an empty key counts as no key', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { browser } = session({ apiKey: '' })
    expect(browser.closedWith).toBe(1011)
  })

  it('a Soniox error response: unavailable, closed 1011, only the code logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { browser, upstream } = session()
    upstream.open()
    upstream.text('{"error_code":401,"error_message":"Invalid API key: secret words"}')
    expect(browser.json).toEqual([{ type: 'ready' }, { type: 'unavailable', reason: 'load_failed' }])
    expect(browser.closedWith).toBe(1011)
    expect(upstream.closed).toBe(true)
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('[soniox] error 401')
    expect(logged).not.toContain('secret')
  })

  it('a socket error or an unexpected close from Soniox: unavailable once', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { browser, upstream } = session()
    upstream.emit('error', new Error('ECONNREFUSED'))
    upstream.emit('close', 1006)
    expect(browser.json).toEqual([{ type: 'unavailable', reason: 'load_failed' }])
    expect(browser.closedWith).toBe(1011)
  })

  it('never logs token text', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { upstream } = session()
    upstream.open()
    upstream.text(response([{ text: 'salajane', is_final: true }, { text: '<end>', is_final: true }]))
    const logged = [...info.mock.calls, ...warn.mock.calls].flat().join(' ')
    expect(logged).not.toContain('salajane')
  })
})

describe('lifecycle', () => {
  it('when the browser closes, Soniox gets the empty end frame and is closed, with no unavailable', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { browser, upstream } = session()
    upstream.open()
    browser.emit('close', 1000)
    expect(upstream.sent.at(-1)).toBe('')
    expect(upstream.closed).toBe(true)
    upstream.emit('close', 1000)
    expect(browser.json).toEqual([{ type: 'ready' }])
  })

  it('finished from Soniox delivers what is left as a final and closes the upstream', () => {
    const { browser, upstream } = session()
    upstream.open()
    upstream.text(response([{ text: 'Lõpp', is_final: true }], { finished: true }))
    expect(browser.json).toEqual([{ type: 'ready' }, { type: 'partial', text: 'Lõpp' }, { type: 'final', text: 'Lõpp' }])
    expect(upstream.closed).toBe(true)
  })

  it('sends a keepalive on the period while open and stops when the browser leaves', () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { browser, upstream } = session({ keepaliveMs: 1000 })
    upstream.open()
    vi.advanceTimersByTime(2500)
    expect(upstream.sent.filter((item) => item === SONIOX_KEEPALIVE)).toHaveLength(2)
    browser.emit('close', 1000)
    vi.advanceTimersByTime(5000)
    expect(upstream.sent.filter((item) => item === SONIOX_KEEPALIVE)).toHaveLength(2)
  })
})

describe('choosing the engine', () => {
  it('goes to Soniox on ?engine=soniox or UTLE_ASR=soniox, else to the local model', async () => {
    const { wantsSoniox } = await import('./asr.ts')
    expect(wantsSoniox('/api/asr?engine=soniox', {})).toBe(true)
    expect(wantsSoniox('/api/asr?engine=local', {})).toBe(false)
    expect(wantsSoniox('/api/asr', {})).toBe(false)
    expect(wantsSoniox('/api/asr', { UTLE_ASR: 'soniox' })).toBe(true)
    expect(wantsSoniox('/api/asr', { UTLE_ASR: 'local' })).toBe(false)
  })
})
